"""
Mistral AI helpers — replaces all OpenAI calls for free tier usage.
Sign up at https://console.mistral.ai (no credit card needed).
"""

import os
import base64
import json
import requests
from typing import Any

MISTRAL_API_KEY = os.environ.get("MISTRAL_API_KEY", "")
MISTRAL_ENDPOINT = "https://api.mistral.ai/v1"

HEADERS = {
    "Authorization": f"Bearer {MISTRAL_API_KEY}",
    "Content-Type": "application/json",
}


def _check_key():
    if not MISTRAL_API_KEY:
        raise RuntimeError(
            "MISTRAL_API_KEY not set. Get a free key at https://console.mistral.ai"
        )


def mistral_chat(
    messages: list[dict],
    model: str = "mistral-large-latest",
    max_tokens: int = 300,
    response_format: dict | None = None,
    temperature: float = 0.3,
) -> str:
    """Call Mistral chat/completions. Supports text + image content."""
    _check_key()

    body: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
    }
    if response_format:
        body["response_format"] = response_format

    resp = requests.post(
        f"{MISTRAL_ENDPOINT}/chat/completions",
        headers=HEADERS,
        json=body,
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"].strip()


def mistral_chat_json(
    messages: list[dict],
    model: str = "mistral-large-latest",
    max_tokens: int = 500,
    temperature: float = 0.3,
) -> dict:
    """Call Mistral and parse response as JSON."""
    text = mistral_chat(
        messages=messages,
        model=model,
        max_tokens=max_tokens,
        response_format={"type": "json_object"},
        temperature=temperature,
    )
    # Strip markdown fences if present
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    return json.loads(text)


def mistral_vision(
    prompt: str,
    image_b64: str,
    model: str = "pixtral-large-latest",
    max_tokens: int = 300,
    response_format: dict | None = None,
) -> str:
    """Send a text + image prompt to Mistral Pixtral (vision)."""
    content: list[dict] = [
        {"type": "text", "text": prompt},
        {
            "type": "image_url",
            "image_url": f"data:image/jpeg;base64,{image_b64}",
        },
    ]

    messages = [{"role": "user", "content": content}]

    if response_format:
        return mistral_chat_json(
            messages=messages,
            model=model,
            max_tokens=max_tokens,
        )
    return mistral_chat(
        messages=messages,
        model=model,
        max_tokens=max_tokens,
    )


def mistral_embed(texts: list[str], model: str = "mistral-embed") -> list[list[float]]:
    """Generate embeddings via Mistral Embed API (free tier available)."""
    _check_key()

    resp = requests.post(
        f"{MISTRAL_ENDPOINT}/embeddings",
        headers=HEADERS,
        json={
            "model": model,
            "input": texts,
        },
        timeout=60,
    )
    resp.raise_for_status()
    data = resp.json()
    # Sort by index to maintain order
    sorted_data = sorted(data["data"], key=lambda x: x["index"])
    return [d["embedding"] for d in sorted_data]
