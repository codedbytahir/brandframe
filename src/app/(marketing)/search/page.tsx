import { Suspense } from "react";
import Link from "next/link";
import { Search as SearchIcon, Sparkles } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { hybridSearch, generateAiOverview, type SearchResult } from "@/lib/rag/search";
import { matchBrandIntent } from "@/lib/ads/intent";
import { SponsoredCard } from "@/components/ads/sponsored-card";
import { formatTimestamp } from "@/lib/utils";

interface SearchPageProps {
  searchParams: Promise<{ q?: string }>;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Highlight query terms in transcripts with <mark>. */
function Highlighted({ text, query }: { text: string; query: string }) {
  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  if (terms.length === 0) return <>{text}</>;
  const re = new RegExp(`(${terms.map(escapeRegex).join("|")})`, "gi");
  const parts = text.split(re);
  return (
    <>
      {parts.map((part, i) =>
        re.test(part) ? (
          <mark key={i} className="rounded bg-primary/25 px-0.5 text-foreground">
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </>
  );
}

/** Parse "[N](t:MM:SS)" citations into clickable chips → /watch/<vid>?t=ms. */
function OverviewWithCitations({ overview, results }: { overview: string; results: SearchResult[] }) {
  const nodes: React.ReactNode[] = [];
  const re = /\[(\d+)\]\(t:(\d+):(\d{2})\)/g;
  let last = 0;
  let key = 0;
  for (const m of overview.matchAll(re)) {
    const idx = m.index!;
    if (idx > last) nodes.push(<span key={`t-${key++}`}>{overview.slice(last, idx)}</span>);
    const n = parseInt(m[1], 10);
    const ms = (parseInt(m[2], 10) * 60 + parseInt(m[3], 10)) * 1000;
    const target = results[n - 1];
    if (target) {
      nodes.push(
        <Link
          key={`c-${key++}`}
          href={`/watch/${target.videoId}?t=${ms}`}
          className="mx-0.5 inline-flex items-center rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-primary hover:bg-primary/20"
          title={`${target.videoTitle} — ${formatTimestamp(ms)}`}
        >
          [{n}] {formatTimestamp(ms)}
        </Link>
      );
    } else {
      nodes.push(<span key={`c-${key++}`}>{m[0]}</span>);
    }
    last = idx + m[0].length;
  }
  if (last < overview.length) nodes.push(<span key={`t-${key++}`}>{overview.slice(last)}</span>);
  return <p className="whitespace-pre-wrap text-sm leading-relaxed">{nodes}</p>;
}

async function AiOverviewCard({ query, results }: { query: string; results: SearchResult[] }) {
  const overview = await generateAiOverview(query, results);
  return (
    <Card className="border-primary/30 bg-card">
      <CardContent className="p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-primary" />
          AI Overview
        </div>
        <OverviewWithCitations overview={overview} results={results} />
      </CardContent>
    </Card>
  );
}

function ResultCard({ result, query }: { result: SearchResult; query: string }) {
  const watchHref = `/watch/${result.videoId}?t=${result.startMs}`;
  return (
    <Card className="bg-card transition-colors hover:border-primary/40">
      <CardContent className="flex gap-4 p-4">
        <Link href={watchHref} className="relative h-24 w-40 shrink-0 overflow-hidden rounded-md bg-muted">
          {result.thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={result.thumbnailUrl} alt={result.videoTitle} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center font-mono text-xs text-muted-foreground">
              {formatTimestamp(result.startMs)}
            </div>
          )}
        </Link>
        <div className="min-w-0 flex-1">
          <Link href={watchHref}>
            <h3 className="truncate font-semibold hover:text-primary">{result.videoTitle}</h3>
          </Link>
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
            <Highlighted text={result.transcript} query={query} />
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Link
              href={watchHref}
              className="rounded bg-muted px-1.5 py-0.5 font-mono text-primary hover:bg-primary/20"
            >
              {formatTimestamp(result.startMs)} → {formatTimestamp(result.endMs)}
            </Link>
            {result.topic && <span className="rounded bg-muted px-1.5 py-0.5">{result.topic}</span>}
            <span>score {result.score.toFixed(2)}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const { q: query = "" } = await searchParams;
  const results = query.trim() ? await hybridSearch({ query: query.trim(), limit: 8 }) : [];
  // Layer 1 — intent overlay: one sponsored card per query, score ≥ 0.3
  const intentMatch = query.trim() ? await matchBrandIntent(query.trim()) : null;

  return (
    <div className="container mx-auto max-w-4xl px-4 py-8">
      <div className="mb-8">
        <form className="flex gap-2">
          <Input
            name="q"
            placeholder="Search videos… e.g., 'how do I center a div'"
            defaultValue={query}
            className="flex-1"
          />
          <Button type="submit" aria-label="Search">
            <SearchIcon className="h-4 w-4" />
          </Button>
        </form>
      </div>

      {query && (
        <>
          <div className="mb-4">
            <h2 className="text-sm text-muted-foreground">
              {results.length} result{results.length === 1 ? "" : "s"} for &quot;{query}&quot;
            </h2>
          </div>

          <div className="mb-6">
            <Suspense
              fallback={
                <Card className="border-primary/30 bg-card">
                  <CardContent className="space-y-2 p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <Sparkles className="h-4 w-4 text-primary" /> AI Overview
                    </div>
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-5/6" />
                    <Skeleton className="h-4 w-2/3" />
                  </CardContent>
                </Card>
              }
            >
              <AiOverviewCard query={query.trim()} results={results} />
            </Suspense>
          </div>

          <div className="space-y-4">
            {intentMatch && <SponsoredCard match={intentMatch} />}
            {results.map((r) => (
              <ResultCard key={`${r.segmentId}-${r.startMs}`} result={r} query={query.trim()} />
            ))}
            {results.length === 0 && (
              <p className="rounded-md border border-border bg-card p-6 text-center text-sm text-muted-foreground">
                No matching moments found. Try broader keywords — the search covers every
                spoken sentence in the catalog.
              </p>
            )}
          </div>
        </>
      )}

      {!query && (
        <div className="rounded-md border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          Search across every spoken sentence in the video catalog — results deep-link to the
          exact moment.
        </div>
      )}
    </div>
  );
}
