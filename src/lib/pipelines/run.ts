import { spawn } from "child_process";
import fs from "fs";
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
 *
 * Only genuine failures reach `onError` (JSONL "error" events, non-zero
 * exit before a terminal event, spawn errors). Non-JSON stdout/stderr
 * noise (nltk downloads, tqdm bars, warnings) goes to `onRawLine` so it
 * never flips a video to "failed" by accident.
 */
export function runIngestPipeline(
  videoId: string,
  b2Key: string,
  onLog: (progress: PipelineProgress) => void,
  onError: (error: string) => void,
  onComplete: (result: PipelineResult) => void,
  onRawLine?: (line: string, source: "stdout" | "stderr") => void
): () => void {
  const projectRoot = process.cwd();
  const venvPath = process.env.PIPELINE_VENV || ".venv";
  const pythonBin = path.join(projectRoot, venvPath, "bin", "python");

  // Fallback to system python if venv doesn't exist
  const pythonCmd = fs.existsSync(pythonBin) ? pythonBin : "python3";

  const proc = spawn(pythonCmd, ["-m", "pipelines.cli", "ingest", "--key", b2Key], {
    cwd: projectRoot,
    env: {
      ...process.env,
      // Stop Python from implicitly searching the CWD (repo root) for imports.
      // PYTHONPATH keeps `python -m pipelines.cli` resolvable explicitly.
      // No-op on Python < 3.11.
      PYTHONSAFEPATH: "1",
      PYTHONPATH: `${projectRoot}${path.delimiter}${process.env.PYTHONPATH ?? ""}`,
      // nltk >= 3.10 installs an import-hijack guard (inisec.py) that misfires
      // when the venv is inside the project directory — its site-packages match
      // its naive "path is under CWD" check and legit imports (regex) get
      // blocked. Officially supported kill switch. Harmless on nltk < 3.10.
      NLTK_DISABLE_IMPORT_SECURITY: "1",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let killed = false;
  // Set once a terminal event ("complete" or "error") has been handled, so a
  // trailing non-zero exit code doesn't double-report a failure.
  let terminalEventSeen = false;

  const handleLine = (trimmed: string, source: "stdout" | "stderr") => {
    try {
      const parsed = JSON.parse(trimmed);

      if (parsed.event === "progress") {
        onLog({
          step: parsed.step || "unknown",
          status: parsed.status || "running",
          progress: parsed.progress || 0,
          message: parsed.message || "",
        });
        return;
      }
      if (parsed.event === "complete") {
        terminalEventSeen = true;
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
      if (parsed.event === "error") {
        terminalEventSeen = true;
        onError(parsed.traceback || parsed.error || "Unknown pipeline error");
        return;
      }
      // Unknown JSON event — treat as raw noise.
    } catch {
      // Not JSON — raw stdout/stderr noise (warnings, progress bars, nltk logs).
    }
    onRawLine?.(trimmed, source);
  };

  // Line-buffered reader for a child stream.
  const buffers = { stdout: "", stderr: "" };
  const attach = (
    stream: NodeJS.ReadableStream | null,
    source: "stdout" | "stderr"
  ) => {
    stream?.on("data", (data: Buffer) => {
      if (killed) return;
      buffers[source] += data.toString();
      const lines = buffers[source].split("\n");
      buffers[source] = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) handleLine(trimmed, source);
      }
    });
  };
  attach(proc.stdout, "stdout");
  attach(proc.stderr, "stderr");

  proc.on("close", (code) => {
    if (killed) return;
    // Flush any trailing line that lacked "\n" (stdout first — final events
    // are emitted there; stderr tail is noise unless it's a JSONL event).
    for (const source of ["stdout", "stderr"] as const) {
      const tail = buffers[source].trim();
      if (tail) {
        buffers[source] = "";
        handleLine(tail, source);
      }
    }
    if (!terminalEventSeen && code !== 0) {
      terminalEventSeen = true;
      onError(`Pipeline exited with code ${code}`);
    }
  });

  proc.on("error", (err) => {
    if (!killed && !terminalEventSeen) {
      terminalEventSeen = true;
      onError(`Pipeline spawn error: ${err.message}`);
    }
  });

  return () => {
    killed = true;
    proc.kill("SIGTERM");
    setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {}
    }, 5000);
  };
}
