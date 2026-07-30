export type VideoStatus = "uploading" | "processing" | "ready" | "failed";
export type SlotStatus = "pending" | "filled" | "approved" | "rejected" | "failed";
export type SlotLayer = 1 | 2 | 3;

export interface Video {
  id: string; // vid_<id>
  title: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  durationMs: number | null;
  status: VideoStatus;
  b2Key: string; // uploads/<id>/source.mp4
  hlsUrl: string | null;
  posterUrl: string | null;
  thumbnailUrl: string | null;
  userId: string;
  createdAt: string;
  updatedAt: string;
}

export interface Segment {
  id: string; // seg_<id>
  videoId: string;
  index: number;
  startMs: number;
  endMs: number;
  transcript: string;
  topic: string | null;
  keyframeUrl: string | null;
  embeddingDense: number[] | null;
  embeddingSparse: number[] | null;
  embeddingVisual: number[] | null;
  createdAt: string;
}

export interface AdSlot {
  id: string; // slot_<id>
  videoId: string;
  segmentId: string | null;
  layer: SlotLayer;
  timestampMs: number;
  status: SlotStatus;
  surfaceLabel: string | null;
  bbox: [number, number, number, number] | null;
  brandId: string | null;
  beforeFrameUrl: string | null;
  afterFrameUrl: string | null;
  rejectReason: string | null;
  manifestEntry: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Brand {
  id: string; // brd_<id>
  name: string;
  category: string;
  logoUrl: string | null;
  packshotUrl: string | null;
  colorHex: string;
  allowedSurfaces: string[];
  createdAt: string;
}

export interface NaturalBreak {
  id: string; // brk_<id>
  videoId: string;
  timestampMs: number;
  score: number;
  createdAt: string;
}

export interface Cue {
  slotId: string;
  videoId: string;
  layer: SlotLayer;
  timestampMs: number;
  durationMs: number;
  brandName: string;
  brandColor: string;
  afterFrameUrl: string;
  beforeFrameUrl: string;
  surfaceLabel: string;
}

export interface ManifestEntry {
  step: string;
  provider: string;
  model: string;
  inputSha256: string;
  outputSha256: string;
  b2Key: string;
  durationMs: number;
  status: "success" | "fallback" | "failed";
  retention: { mode: "COMPLIANCE" | "GOVERNANCE"; days: number };
  timestamp: string;
}

export interface Manifest {
  manifestId: string;
  videoId: string;
  version: "1.0";
  createdAt: string;
  retention: { mode: "COMPLIANCE"; days: number };
  entries: ManifestEntry[];
  placements: Array<{
    slotId: string;
    brandId: string;
    beforeSha256: string;
    afterSha256: string;
    bbox: [number, number, number, number];
    creatorApprovedAt: string | null;
  }>;
}
