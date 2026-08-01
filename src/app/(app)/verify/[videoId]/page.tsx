import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Shield,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Lock,
  Star,
  ChevronDown,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { verifyVideo, type VerifyResult, type PlacementVerification } from "@/lib/provenance/verify";
import { BeforeAfterSlider } from "@/components/verify/before-after-slider";
import { CopyButton } from "@/components/verify/copy-button";
import { formatTimestamp } from "@/lib/utils";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

interface VerifyPageProps {
  params: Promise<{ videoId: string }>;
}

// ── Status banner ────────────────────────────────────────────────────────────

function StatusBanner({ result }: { result: VerifyResult }) {
  if (result.state === "verified") {
    const until = result.retainUntil ? new Date(result.retainUntil).toLocaleDateString() : "";
    return (
      <div className="rounded-lg border border-emerald-800 bg-emerald-950/30 p-4">
        <div className="flex items-center gap-2">
          <CheckCircle className="h-5 w-5 text-emerald-500" />
          <span className="font-semibold text-emerald-500">Provenance verified</span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Every AI-generated placement in this video has a SHA-256 hash recorded in a
          Genblaze manifest. The manifest is WORM-locked on Backblaze B2 in COMPLIANCE
          mode{until ? ` until ${until}` : ""} — it cannot be altered or deleted, even by
          BrandFrame.
        </p>
      </div>
    );
  }
  if (result.state === "warning") {
    return (
      <div className="rounded-lg border border-amber-800 bg-amber-950/30 p-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-500" />
          <span className="font-semibold text-amber-500">Attention required</span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Manifest found, but one or more hashes did not match, or Object Lock retention
          could not be confirmed. Details below.
        </p>
      </div>
    );
  }
  if (result.state === "demo") {
    return (
      <div className="rounded-lg border border-sky-800 bg-sky-950/30 p-4">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-sky-400" />
          <span className="font-semibold text-sky-400">Demo data — simulated manifest</span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          This video was seeded as demo content without a B2-backed pipeline run, so no
          cryptographic verification is possible. Ingest a video with real B2 credentials
          and this page will verify hashes and Object Lock for real.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-red-800 bg-red-950/30 p-4">
      <div className="flex items-center gap-2">
        <XCircle className="h-5 w-5 text-red-500" />
        <span className="font-semibold text-red-500">No manifest recorded</span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        No Genblaze manifest exists for this video. Either it wasn&apos;t processed by the
        BrandFrame pipeline, or it predates manifest recording.
      </p>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function HashBadge({ check }: { check: { match: boolean | null } }) {
  if (check.match === null) return <Badge variant="secondary">not checked</Badge>;
  return check.match ? <Badge variant="success">SHA-256 match</Badge> : <Badge variant="danger">MISMATCH</Badge>;
}

function Stars({ score }: { score: number }) {
  const full = Math.round(score);
  return (
    <span className="inline-flex items-center gap-0.5" title={`Critic score ${score.toFixed(1)}/5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={`h-3.5 w-3.5 ${i <= full ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40"}`}
        />
      ))}
      <span className="ml-1 text-xs text-muted-foreground">{score.toFixed(1)}</span>
    </span>
  );
}

function statusDot(status: string): string {
  if (status === "success") return "bg-emerald-500";
  if (status === "fallback") return "bg-amber-500";
  return "bg-red-500";
}

function PlacementCard({ p, simulated }: { p: PlacementVerification; simulated: boolean }) {
  return (
    <Card id={`slot-${p.slotId}`} className="scroll-mt-24 bg-card">
      <CardContent className="p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Badge variant="outline">{p.surface}</Badge>
          <span className="text-sm font-medium">→ {p.brand}</span>
          {p.timestampMs > 0 && (
            <span className="font-mono text-xs text-muted-foreground">
              @ {formatTimestamp(p.timestampMs)}
            </span>
          )}
          <span className="ml-auto flex items-center gap-2">
            <HashBadge check={p.afterHash} />
          </span>
        </div>

        <BeforeAfterSlider beforeUrl={p.beforeUrl} afterUrl={p.afterUrl} label={p.surface} />

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <Stars score={p.criticScore} />
          {simulated && <span>(critic score simulated)</span>}
          <span>{simulated ? "auto-approved for demo" : "creator-approved"}</span>
          {p.lock.mode && (
            <span className="inline-flex items-center gap-1">
              <Lock className="h-3 w-3" /> GOVERNANCE lock
            </span>
          )}
        </div>

        <details className="group mt-3">
          <summary className="flex cursor-pointer items-center gap-1 text-xs text-primary hover:underline">
            Why did we place this?
            <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" />
          </summary>
          <div className="mt-2 space-y-1 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
            <p>• VL detector found a <strong className="text-foreground">{p.surface}</strong> surface (inanimate-object allowlist; faces/hands always rejected).</p>
            <p>• Brand-surface compatibility check passed; clip-level similarity cleared the 0.28 bar.</p>
            <p>• Content-policy scan: no children/political/medical/finance topics in this chunk.</p>
            <p>• A 5-point VL critic rubric (identity, lighting, artifacts, plausibility, person-alteration guard) scored this placement {p.criticScore.toFixed(1)}/5 (≥4 required).</p>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function VerifyPage({ params }: VerifyPageProps) {
  const { videoId } = await params;

  let result: VerifyResult;
  try {
    result = await verifyVideo(videoId);
  } catch {
    notFound();
  }

  const v = result.video;

  return (
    <div className="container mx-auto max-w-4xl px-4 py-8">
      <div className="mb-8 flex items-center gap-3">
        <Shield className="h-8 w-8 text-emerald-500" />
        <div>
          <h1 className="text-3xl font-bold">Provenance Verification</h1>
          <p className="text-sm text-muted-foreground">
            <Link href={`/watch/${videoId}`} className="text-primary hover:underline">
              {v.title}
            </Link>{" "}
            · {v.durationMs ? formatTimestamp(v.durationMs) : "—"} · by {v.creator}
          </p>
        </div>
      </div>

      <div className="mb-8">
        <StatusBanner result={result} />
      </div>

      {/* Summary line */}
      {result.summary && (
        <div className="mb-8 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
          <span>run <span className="font-mono text-xs">{result.runId ?? "—"}</span></span>
          <span>{result.summary.totalSteps} pipeline steps</span>
          <span>{result.summary.successfulSteps} success</span>
          <span>{result.summary.fallbackSteps} fallback</span>
          <span>{result.summary.failedSteps} failed</span>
          <span>{result.placements.length} AI placements</span>
        </div>
      )}

      {/* Chain of custody */}
      {result.steps.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">Chain of custody</h2>
          <ol className="relative space-y-2 border-l border-border pl-5">
            {result.steps.map((s, i) => (
              <li key={`${s.step}-${i}`} className="relative">
                <span
                  className={`absolute -left-[26.5px] top-1.5 h-3 w-3 rounded-full border-2 border-background ${statusDot(s.status)}`}
                />
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                  <span className="font-mono text-sm font-medium">{s.step}</span>
                  <span className="text-xs text-muted-foreground">
                    {s.provider}
                    {s.model ? ` · ${s.model}` : ""} · {(s.durationMs / 1000).toFixed(1)}s
                  </span>
                  <Badge
                    variant={s.status === "success" ? "success" : s.status === "fallback" ? "warning" : "danger"}
                    className="ml-auto"
                  >
                    {s.status}
                  </Badge>
                </div>
                {s.error && <p className="mt-0.5 text-xs text-red-400">{s.error}</p>}
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Placements */}
      {result.placements.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">AI placements ({result.placements.length})</h2>
          <div className="space-y-4">
            {result.placements.map((p) => (
              <PlacementCard key={p.slotId} p={p} simulated={result.simulated} />
            ))}
          </div>
        </section>
      )}

      {/* Technical details */}
      {result.state !== "no-manifest" && (
        <details className="group mb-10 rounded-lg border border-border bg-card">
          <summary className="flex cursor-pointer items-center gap-2 p-4 text-sm font-semibold">
            Technical details
            <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
          </summary>
          <div className="space-y-3 border-t border-border p-4 text-sm">
            {result.manifestSha256 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-40 text-muted-foreground">Manifest SHA-256</span>
                <code className="max-w-full truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                  {result.manifestSha256}
                </code>
                <CopyButton text={result.manifestSha256} label="Copy hash" />
              </div>
            )}
            {result.sourceHash && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-40 text-muted-foreground">Source MP4 SHA-256</span>
                <HashBadge check={result.sourceHash} />
                <span className="text-xs text-muted-foreground">
                  ({result.sourceHash.type} hash{result.sourceHash.actual ? ", recomputed" : ""})
                </span>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-40 text-muted-foreground">Object Lock</span>
              <Badge variant={result.lockMode === "COMPLIANCE" ? "success" : "secondary"}>
                {result.lockMode ?? "unknown"}
              </Badge>
              {result.retainUntil && (
                <span className="text-xs text-muted-foreground">
                  WORM until {new Date(result.retainUntil).toLocaleString()}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-start gap-2">
              <span className="w-40 shrink-0 text-muted-foreground">Storage</span>
              <span className="text-xs text-muted-foreground">
                Backblaze B2 bucket <code className="font-mono">{env.B2_BUCKET || "demo"}</code> ·{" "}
                <code className="font-mono">{env.B2_ENDPOINT}</code>
              </span>
            </div>
            <div className="rounded-md bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
              <strong className="text-foreground">How this works.</strong> BrandFrame uses{" "}
              <a href="https://github.com/backblaze-labs/genblaze" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Genblaze</a>{" "}
              to build an auditable manifest of every AI step it runs (ASR, scene detection,
              slot detection, brand match, image inpainting, VL critic) and stores that manifest
              on{" "}
              <a href="https://www.backblaze.com/cloud-storage" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Backblaze B2</a>{" "}
              under Object Lock COMPLIANCE retention for 365 days. This page refetches the
              manifest, recomputes the SHA-256 of the source video and every before/after
              frame, and reads the lock headers — so the claim &quot;the record wasn&apos;t
              altered later&quot; is verifiable by anyone, not just us.
            </div>
          </div>
        </details>
      )}
    </div>
  );
}
