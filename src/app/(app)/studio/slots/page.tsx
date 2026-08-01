import Link from "next/link";
import { asc, desc, eq } from "drizzle-orm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { db } from "@/lib/db";
import { adSlots, brands, videos } from "@/lib/db/schema";
import { approveSlot, rejectSlot, resetSlot } from "./actions";
import { formatTimestamp } from "@/lib/utils";

export const dynamic = "force-dynamic";

function StatusBadge({ status }: { status: string }) {
  const variant =
    status === "approved" ? "success" : status === "rejected" ? "danger" : "secondary";
  return <Badge variant={variant as "success" | "secondary" | "danger"}>{status}</Badge>;
}

export default async function StudioSlotsPage() {
  const rows = await db
    .select({
      id: adSlots.id,
      videoId: adSlots.videoId,
      layer: adSlots.layer,
      timestampMs: adSlots.timestampMs,
      status: adSlots.status,
      surfaceLabel: adSlots.surfaceLabel,
      beforeFrameUrl: adSlots.beforeFrameUrl,
      afterFrameUrl: adSlots.afterFrameUrl,
      rejectReason: adSlots.rejectReason,
      brandName: brands.name,
      brandColor: brands.colorHex,
      videoTitle: videos.title,
    })
    .from(adSlots)
    .innerJoin(brands, eq(adSlots.brandId, brands.id))
    .innerJoin(videos, eq(adSlots.videoId, videos.id))
    .orderBy(asc(adSlots.videoId), asc(adSlots.timestampMs));

  const pending = rows.filter((r) => r.status === "filled" || r.status === "pending");
  const decided = rows.filter((r) => !pending.includes(r));

  return (
    <div className="container mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Placement approvals</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Review AI in-scene placements (before → after). Inpaint runs at ingest; you can
            reject after the fact — rejected placements never render (ADR-009).
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/studio">← Studio</Link>
        </Button>
      </div>

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Awaiting review ({pending.length})
      </h2>
      <div className="space-y-4">
        {pending.map((s) => (
          <Card key={s.id} id={s.id} className="bg-card">
            <CardContent className="p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span
                  className="rounded-md px-2 py-0.5 text-xs font-medium text-white"
                  style={{ backgroundColor: s.brandColor }}
                >
                  {s.brandName}
                </span>
                <StatusBadge status={s.status} />
                <span className="text-xs text-muted-foreground">
                  Layer {s.layer} · {s.surfaceLabel} @ {formatTimestamp(s.timestampMs)} ·{" "}
                  <Link href={`/watch/${s.videoId}?t=${s.timestampMs}`} className="text-primary hover:underline">
                    {s.videoTitle}
                  </Link>
                </span>
              </div>

              <div className="mb-3 grid grid-cols-2 gap-3">
                {[["Before", s.beforeFrameUrl], ["After (AI placement)", s.afterFrameUrl]].map(
                  ([label, url]) => (
                    <figure key={label as string} className="overflow-hidden rounded-md bg-muted">
                      {url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={url as string} alt={label as string} className="aspect-video w-full object-cover" />
                      ) : (
                        <div className="flex aspect-video items-center justify-center text-xs text-muted-foreground">
                          {label}: frame pending
                        </div>
                      )}
                      <figcaption className="px-2 py-1 text-center text-[10px] text-muted-foreground">
                        {label}
                      </figcaption>
                    </figure>
                  )
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <form action={approveSlot}>
                  <input type="hidden" name="slotId" value={s.id} />
                  <Button type="submit" size="sm">
                    Approve
                  </Button>
                </form>
                <form action={rejectSlot} className="flex flex-1 items-center gap-2">
                  <input type="hidden" name="slotId" value={s.id} />
                  <Input
                    name="reason"
                    placeholder="Reject reason (optional)"
                    className="h-8 max-w-xs text-xs"
                  />
                  <Button type="submit" size="sm" variant="outline">
                    Reject
                  </Button>
                </form>
              </div>
            </CardContent>
          </Card>
        ))}
        {pending.length === 0 && (
          <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Nothing awaiting review. New placements appear here when the pipeline fills slots.
          </p>
        )}
      </div>

      {decided.length > 0 && (
        <>
          <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Decided ({decided.length})
          </h2>
          <div className="space-y-2">
            {decided.map((s) => (
              <div
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card p-3 text-sm"
              >
                <div className="flex items-center gap-2">
                  <StatusBadge status={s.status} />
                  <span>{s.brandName}</span>
                  <span className="text-xs text-muted-foreground">
                    {s.surfaceLabel} @ {formatTimestamp(s.timestampMs)} · {s.videoTitle}
                  </span>
                  {s.rejectReason && (
                    <span className="text-xs text-muted-foreground">— {s.rejectReason}</span>
                  )}
                </div>
                <form action={resetSlot}>
                  <input type="hidden" name="slotId" value={s.id} />
                  <Button type="submit" size="sm" variant="ghost">
                    Reset
                  </Button>
                </form>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
