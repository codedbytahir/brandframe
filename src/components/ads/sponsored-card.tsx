import type { BrandIntentMatch } from "@/lib/ads/intent";

/**
 * Layer 1 — Sponsored intent card (search results / chat answers).
 * FTC disclosure: the word "Sponsored" is mandatory and always visible.
 * Server-renderable (no client hooks).
 */
export function SponsoredCard({
  match,
  compact = false,
}: {
  match: BrandIntentMatch;
  compact?: boolean;
}) {
  const { brand } = match;
  return (
    <div
      className="rounded-md border border-border border-l-4 bg-card p-4"
      style={{ borderLeftColor: brand.colorHex }}
    >
      <div className="flex items-start gap-3">
        {brand.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={brand.logoUrl}
            alt={`${brand.name} logo`}
            className="h-10 w-10 rounded-md object-cover"
          />
        ) : (
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-sm font-bold text-white"
            style={{ backgroundColor: brand.colorHex }}
          >
            {brand.name.slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{brand.name}</span>
            <span className="rounded border border-muted-foreground/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              Sponsored
            </span>
            <span className="text-[10px] text-muted-foreground">
              content-matched brand, not user-targeted
            </span>
          </div>
          {!compact && brand.copy && (
            <p className="mt-1 text-sm text-muted-foreground">{brand.copy}</p>
          )}
          {!compact && (
            <a
              href={brand.targetUrl}
              target="_blank"
              rel="noopener noreferrer sponsored"
              className="mt-1 inline-block text-xs text-primary hover:underline"
            >
              Learn more →
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
