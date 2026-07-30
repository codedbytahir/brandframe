import { spawn } from "child_process";

export interface PipelineProgress {
  step: string;
  status: "running" | "completed" | "failed" | "fallback";
  progress: number;
  message: string;
}

export interface PipelineResult {
  videoId: string;
  success: boolean;
  durationMs: number | null;
  segmentsCount: number;
  slotsCount: number;
  manifestUrl: string | null;
}

export function runIngestPipeline(
  videoId: string,
  b2Key: string,
  onLog: (progress: PipelineProgress) => void,
  onError: (error: string) => void,
  onComplete: (result: PipelineResult) => void
): () => void {
  const venvPath = process.env.PIPELINE_VENV || ".venv";
  const pythonBin = `${venvPath}/bin/python`;

  const proc = spawn(pythonBin, ["-m", "pipelines.cli", "ingest", "--key", b2Key], {
    cwd: process.cwd(),
    env: { ...process.env },
  });

  let buffer = "";
  const abortController = new AbortController();

  proc.stdout?.on("data", (data: Buffer) => {
    buffer += data.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        if (parsed.event === "progress") {
          onLog({
            step: parsed.step || "unknown",
            status: parsed.status || "running",
            progress: parsed.progress || 0,
            message: parsed.message || "",
          });
        }
      } catch {
        // stderr-style output, ignore
      }
    }
  });

  proc.stderr?.on("data", (data: Buffer) => {
    onError(`[stderr] ${data.toString().trim()}`);
  });

  proc.on("close", (code) => {
    if (code === 0) {
      onComplete({
        videoId,
        success: true,
        durationMs: null,
        segmentsCount: 0,
        slotsCount: 0,
        manifestUrl: null,
      });
    } else {
      onError(`Pipeline exited with code ${code}`);
    }
  });

  proc.on("error", (err) => {
    onError(`Pipeline spawn error: ${err.message}`);
  });

  return () => {
    proc.kill();
    abortController.abort();
  };
}
