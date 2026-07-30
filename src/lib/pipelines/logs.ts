// In-memory pipeline log buffers (keyed by videoId)
const pipelineBuffers = new Map<string, string[]>();

export function addPipelineLog(videoId: string, line: string) {
  if (!pipelineBuffers.has(videoId)) {
    pipelineBuffers.set(videoId, []);
  }
  pipelineBuffers.get(videoId)!.push(line);
  // Keep only last 1000 lines
  const buf = pipelineBuffers.get(videoId)!;
  if (buf.length > 1000) buf.splice(0, buf.length - 1000);
}

export function getPipelineLogs(videoId: string): string[] {
  return pipelineBuffers.get(videoId) || [];
}

export function clearPipelineLogs(videoId: string) {
  pipelineBuffers.delete(videoId);
}
