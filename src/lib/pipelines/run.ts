import { spawn } from "child_process";
import path from "path";

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

/**
 * Spawn the Genblaze Python pipeline as a child process.
 * Returns a cancel function to kill the process.
 */
export function runIngestPipeline(
  videoId: string,
  b2Key: string,
  onLog: (progress: PipelineProgress) => void,
  onError: (error: string) => void,
  onComplete: (result: PipelineResult) => void
): () => void {
  const projectRoot = process.cwd();
  const venvPath = process.env.PIPELINE_VENV || ".venv";
  const pythonBin = path.join(projectRoot, venvPath, "bin", "python");

  // Fallback to system python if venv doesn't exist
  const pythonCmd = require("fs").existsSync(pythonBin) ? pythonBin : "python3";

  const proc = spawn(pythonCmd, ["-m", "pipelines.cli", "ingest", "--key", b2Key], {
    cwd: projectRoot,
    env: { ...process.env },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let buffer = "";
  let killed = false;

  const onData = (data: Buffer) => {
    if (killed) return;
    buffer += data.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const parsed = JSON.parse(trimmed);

        if (parsed.event === "progress") {
          onLog({
            step: parsed.step || "unknown",
            status: parsed.status || "running",
            progress: parsed.progress || 0,
            message: parsed.message || "",
          });
        } else if (parsed.event === "complete") {
          const d = parsed.data || {};
          onComplete({
            videoId: d.video_id || videoId,
            success: d.success !== false,
            durationMs: d.total_duration_ms || null,
            segmentsCount: 0,
            slotsCount: 0,
            manifestUrl: d.manifest_key || null,
          });
        } else if (parsed.event === "error") {
          onError(parsed.traceback || parsed.error || "Unknown pipeline error");
        }
      } catch {
        // Not JSON — forward as stderr-style output
        onError(`[pipeline] ${trimmed}`);
      }
    }
  };

  proc.stdout?.on("data", onData);
  proc.stderr?.on("data", (data: Buffer) => {
    if (!killed) {
      onError(`[stderr] ${data.toString().trim()}`);
    }
  });

  proc.on("close", (code) => {
    if (killed) return;
    // Flush remaining buffer
    if (buffer.trim()) {
      try {
        const parsed = JSON.parse(buffer.trim());
        if (parsed.event === "complete") {
          const d = parsed.data || {};
          onComplete({
            videoId: d.video_id || videoId,
            success: d.success !== false,
            durationMs: d.total_duration_ms || null,
            segmentsCount: 0,
            slotsCount: 0,
            manifestUrl: d.manifest_key || null,
          });
          return;
        }
      } catch {}
    }
    if (code !== 0) {
      onError(`Pipeline exited with code ${code}`);
    }
  });

  proc.on("error", (err) => {
    if (!killed) {
      onError(`Pipeline spawn error: ${err.message}`);
    }
  });

  return () => {
    killed = true;
    proc.kill("SIGTERM");
    setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch {}
    }, 5000);
  };
}
