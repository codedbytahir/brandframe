// B2 key prefix helpers — never build key strings inline.
// Keep in sync with pipelines/config.py

export function uploadKey(videoId: string): string {
  return `uploads/${videoId}/source.mp4`;
}

export function hlsKey(videoId: string, variant?: string): string {
  return variant
    ? `playable/${videoId}/hls/${variant}`
    : `playable/${videoId}/hls/`;
}

export function posterKey(videoId: string): string {
  return `playable/${videoId}/poster.jpg`;
}

export function thumbnailKey(videoId: string): string {
  return `playable/${videoId}/thumb.jpg`;
}

export function keyframeKey(videoId: string, index: number): string {
  return `assets/${videoId}/keyframes/frame-${String(index).padStart(4, "0")}.jpg`;
}

export function beforeFrameKey(videoId: string, slotId: string): string {
  return `assets/${videoId}/inpaint/${slotId}/before.jpg`;
}

export function afterFrameKey(videoId: string, slotId: string): string {
  return `assets/${videoId}/inpaint/${slotId}/after.jpg`;
}

export function manifestKey(videoId: string): string {
  return `manifests/${videoId}/manifest.json`;
}

export function brandsIndexKey(): string {
  return `index/brands.lance`;
}

export function segmentsIndexKey(videoId: string): string {
  return `index/${videoId}/segments.lance`;
}

export function tmpKey(videoId: string, name: string): string {
  return `tmp/${videoId}/${name}`;
}

export function pipelineLogKey(videoId: string): string {
  return `tmp/${videoId}/pipeline.log`;
}

export const B2_PREFIXES = {
  uploads: "uploads/",
  playable: "playable/",
  assets: "assets/",
  manifests: "manifests/",
  index: "index/",
  brands: "brands/",
  tmp: "tmp/",
} as const;
