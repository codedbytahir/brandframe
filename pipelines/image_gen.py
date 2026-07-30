"""
High-quality image generation for BrandFrame inpainting.

Uses Google Gemini 2.5 Flash Image (aka "Nano Banana") via the free Google AI Studio tier.
  - Model: gemini-2.5-flash-image
  - Free tier: ~500 requests/day, no credit card required
  - Get API key: https://aistudio.google.com → "Get API key" (starts with "AIza...")
  - Quality: State-of-the-art photorealistic 1K+ output

Fallback: Pillow compositing (zero API calls, works fully offline).
"""

import io
import os
import base64
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter, ImageDraw, ImageFont, ImageEnhance

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")


# =====================================================================
# Option 1: Gemini 2.5 Flash Image (Nano Banana) — FREE, high quality
# =====================================================================

def gemini_generate_image(prompt: str, aspect_ratio: str = "1:1") -> bytes | None:
    """Generate a high-quality image via Gemini 2.5 Flash Image (Nano Banana).
    
    Free tier: ~500 requests/day via Google AI Studio API key.
    No credit card required. Sign up at https://aistudio.google.com
    
    Args:
        prompt: Text description of the image to generate
        aspect_ratio: One of "1:1", "16:9", "9:16", "4:3", "3:4", "21:9"
    
    Returns:
        Raw image bytes (JPEG/PNG) or None if failed
    """
    if not GEMINI_API_KEY:
        return None
    
    try:
        from google import genai
        from google.genai import types as genai_types
        
        client = genai.Client(api_key=GEMINI_API_KEY)
        
        response = client.models.generate_content(
            model="gemini-2.5-flash-image",
            contents=prompt,
            config=genai_types.GenerateContentConfig(
                response_modalities=["TEXT", "IMAGE"],
                # aspect_ratio is controlled via prompt instructions
            ),
        )
        
        for part in response.candidates[0].content.parts:
            if part.inline_data is not None:
                return part.inline_data.data
        
        print("[Gemini Gen] No image data in response")
        return None
        
    except Exception as exc:
        print(f"[Gemini Gen] Error: {exc}")
        return None


def gemini_edit_image(
    image_bytes: bytes,
    prompt: str,
    mime_type: str = "image/jpeg",
) -> bytes | None:
    """Edit an existing image using Gemini 2.5 Flash Image.
    
    Perfect for inpainting: send the keyframe + instruction to modify the ad slot area.
    
    Args:
        image_bytes: Raw bytes of the input image
        prompt: Instruction like "Replace the mug on the table with a branded cola can"
        mime_type: MIME type of input image
    
    Returns:
        Raw bytes of the edited image, or None if failed
    """
    if not GEMINI_API_KEY:
        return None
    
    try:
        from google import genai
        from google.genai import types as genai_types
        
        client = genai.Client(api_key=GEMINI_API_KEY)
        
        response = client.models.generate_content(
            model="gemini-2.5-flash-image",
            contents=[
                genai_types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
                prompt,
            ],
            config=genai_types.GenerateContentConfig(
                response_modalities=["TEXT", "IMAGE"],
            ),
        )
        
        for part in response.candidates[0].content.parts:
            if part.inline_data is not None:
                return part.inline_data.data
        
        print("[Gemini Edit] No image data in response")
        return None
        
    except Exception as exc:
        print(f"[Gemini Edit] Error: {exc}")
        return None


# =====================================================================
# Option 2: Pillow compositing (zero API, works offline, always works)
# =====================================================================

def composite_brand_onto_frame(
    keyframe_path: str,
    output_path: str,
    bbox: tuple[int, int, int, int],  # (x1, y1, x2, y2) in pixel coords
    brand_name: str = "Brand",
    brand_color: str = "#f15a22",
) -> str:
    """Create a professional-looking brand composite at the bbox position.
    
    Features:
    - Brand-colored product box with shadow
    - Rounded corners with gradient highlight
    - Brand name label and "AI AD" subtitle
    - Slight random rotation for realism
    - Smooth edge blending
    
    Returns the output path.
    """
    frame = Image.open(keyframe_path).convert("RGB")
    x1, y1, x2, y2 = bbox
    w, h = x2 - x1, y2 - y1
    
    # Ensure minimum size
    if w < 30 or h < 30:
        w, h = max(w, 100), max(h, 100)
    
    # Create brand overlay image
    overlay = _create_brand_overlay(w, h, brand_name, brand_color)
    
    # Slight rotation for realism
    angle = np.random.uniform(-4, 4)
    rotated = overlay.rotate(angle, expand=True, resample=Image.BICUBIC, 
                             fillcolor=(0, 0, 0, 0))
    
    # Center the rotated overlay
    ox = x1 + (w - rotated.width) // 2
    oy = y1 + (h - rotated.height) // 2
    
    # Create composite
    composite = frame.copy().convert("RGBA")
    
    # Add shadow beneath
    shadow = Image.new("RGBA", composite.size, (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    shadow_draw.ellipse(
        [ox - 8, oy + h - 8, ox + w + 8, oy + h + 15],
        fill=(0, 0, 0, 80)
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=6))
    composite = Image.alpha_composite(composite, shadow)
    
    # Paste the brand overlay
    composite.paste(rotated, (ox, oy), rotated)
    
    # Edge soften
    composite = composite.filter(ImageFilter.SMOOTH)
    
    composite.convert("RGB").save(output_path, "JPEG", quality=95)
    return output_path


def _create_brand_overlay(w: int, h: int, brand_name: str, color_hex: str) -> Image.Image:
    """Create a high-quality brand product overlay image."""
    overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    
    # Parse color
    color_hex = color_hex.lstrip("#")
    r, g, b = int(color_hex[0:2], 16), int(color_hex[2:4], 16), int(color_hex[4:6], 16)
    
    # Main body with rounded corners
    body_color = (r, g, b, 235)
    draw.rounded_rectangle([2, 2, w - 2, h - 2], radius=10, fill=body_color)
    
    # Top highlight (gradient effect)
    light_color = (min(r + 50, 255), min(g + 50, 255), min(b + 50, 255), 80)
    draw.rounded_rectangle([4, 4, w - 4, int(h * 0.35)], radius=8, fill=light_color)
    
    # Border
    draw.rounded_rectangle([0, 0, w - 1, h - 1], radius=10, 
                           outline=(255, 255, 255, 90), width=2)
    
    # Brand label
    try:
        font_size = max(11, min(w, h) // 5)
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", font_size)
        small_font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", max(8, font_size // 2))
    except (OSError, IOError):
        font = ImageFont.load_default()
        small_font = font
    
    # White text
    text_color = (255, 255, 255, 245)
    label = brand_name.upper()[:14]
    
    bbox_text = draw.textbbox((0, 0), label, font=font)
    tw = bbox_text[2] - bbox_text[0]
    th = bbox_text[3] - bbox_text[1]
    tx = (w - tw) // 2
    ty = (h - th) // 2 - th // 2
    
    # Text shadow for readability
    draw.text((tx + 1, ty + 1), label, fill=(0, 0, 0, 80), font=font)
    draw.text((tx, ty), label, fill=text_color, font=font)
    
    # Subtitle
    subtitle = "AI AD"
    sub_bbox = draw.textbbox((0, 0), subtitle, font=small_font)
    stx = (w - (sub_bbox[2] - sub_bbox[0])) // 2
    sty = ty + th + 6
    draw.text((stx + 1, sty + 1), subtitle, fill=(0, 0, 0, 60), font=small_font)
    draw.text((stx, sty), subtitle, fill=(255, 255, 255, 170), font=small_font)
    
    return overlay


# =====================================================================
# Main inpainting pipeline
# =====================================================================

def inpaint_slot(
    keyframe_path: str,
    output_path: str,
    bbox_1000: list[float],  # [x1, y1, x2, y2] in 0-1000 normalized
    brand_name: str = "Brand",
    brand_color: str = "#f15a22",
    surface: str = "surface",
    generate_prompt: str | None = None,
) -> str:
    """Inpaint an ad slot on a keyframe using Gemini AI or Pillow fallback.
    
    Strategy:
    1. Try Gemini 2.5 Flash Image (Nano Banana) — free, photorealistic 1K quality
    2. Fallback to Pillow compositing — always works, zero cost
    
    Returns the output path.
    """
    img = Image.open(keyframe_path)
    iw, ih = img.size
    
    # Convert normalized 0-1000 bbox to pixel coords
    x1 = int(bbox_1000[0] * iw / 1000)
    y1 = int(bbox_1000[1] * ih / 1000)
    x2 = int(bbox_1000[2] * iw / 1000)
    y2 = int(bbox_1000[3] * ih / 1000)
    
    # Clamp to image bounds
    x1, x2 = max(0, x1), min(iw, x2)
    y1, y2 = max(0, y1), min(ih, y2)
    
    # --- Try Gemini AI first ---
    if GEMINI_API_KEY:
        try:
            with open(keyframe_path, "rb") as f:
                kf_bytes = f.read()
            
            edit_prompt = (
                f"Edit this image professionally. "
                f"In the area around coordinates ({x1},{y1}) to ({x2},{y2}), "
                f"replace the existing {surface} with a photorealistic high-end "
                f"{brand_name} branded product. "
                f"The product should look naturally placed in the scene with proper "
                f"lighting, shadows, and perspective. "
                f"Keep the rest of the image identical. "
                f"Make the brand logo clearly visible. "
                f"Professional advertising quality, 4K photorealistic."
            )
            
            edited = gemini_edit_image(
                image_bytes=kf_bytes,
                prompt=edit_prompt,
                mime_type="image/jpeg",
            )
            
            if edited:
                with open(output_path, "wb") as f:
                    f.write(edited)
                print(f"[Inpaint] Gemini Nano Banana: edited at ({x1},{y1})-({x2},{y2})")
                return output_path
            else:
                print("[Inpaint] Gemini returned no data, falling back to Pillow")
                
        except Exception as exc:
            print(f"[Inpaint] Gemini failed ({exc}), falling back to Pillow")
    
    # --- Fallback: Pillow compositing ---
    result = composite_brand_onto_frame(
        keyframe_path, output_path,
        bbox=(x1, y1, x2, y2),
        brand_name=brand_name,
        brand_color=brand_color,
    )
    print(f"[Inpaint] Pillow composite at ({x1},{y1})-({x2},{y2})")
    return result
