import Link from "next/link";
import {
  Search,
  MessageSquareText,
  Layers,
  Shield,
  Play,
  Upload,
  ArrowRight,
  BadgeCheck,
  Sparkles,
  Timer,
  Database,
  ScanFace,
  FileLock2,
  MousePointerClick,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const PIPELINE_GROUPS = [
  {
    title: "Ingest",
    icon: Database,
    steps: ["probe", "transcode-hls", "asr", "scenes"],
    blurb: "FFprobe + ffmpeg HLS ladder on B2, Deepgram Nova-3 transcription, scene detection with keyframes.",
  },
  {
    title: "Understand",
    icon: ScanFace,
    steps: ["vl-caption", "chunk", "embed", "breaks"],
    blurb: "Pixtral vision captions, NLTK chunking, mistral-embed vectors, deterministic natural-break scoring.",
  },
  {
    title: "Monetize",
    icon: Layers,
    steps: ["slots", "brand-match", "inpaint", "critic"],
    blurb: "Inanimate-surface detection (faces/hands always rejected), brand matching, Gemini inpainting, VL critic rubric.",
  },
  {
    title: "Prove",
    icon: FileLock2,
    steps: ["manifest"],
    blurb: "Genblaze manifest with SHA-256 hashes, WORM-locked on Backblaze B2 (COMPLIANCE 365d).",
  },
];

const FEATURES = [
  {
    img: "/brand/feat-search.webp",
    icon: Search,
    title: "Semantic search & AI Overview",
    copy: "Hybrid retrieval — mistral-embed dense vectors + BM25 — over every spoken sentence. An AI Overview cites sources you can click straight into the timeline.",
    href: "/search?q=how+do+I+center+a+div",
    cta: "Try “how do I center a div”",
  },
  {
    img: "/brand/feat-ads.webp",
    icon: Layers,
    title: "Three-layer ad engine",
    copy: "Intent overlays in search & chat, natural-break mid-rolls, and the hero feature: in-scene pause ads — AI-inpainted product placements that never interrupt playback.",
    href: "/watch/vid_demo001?t=175000",
    cta: "Watch a pause ad fire at 3:00",
  },
  {
    img: "/brand/feat-verify.webp",
    icon: Shield,
    title: "Cryptographic provenance",
    copy: "Every AI placement is hashed into a manifest locked on B2 in COMPLIANCE mode for 365 days. Nobody — not even us — can quietly alter the record later.",
    href: "/verify/vid_demo001",
    cta: "Verify a video",
  },
];

const DEMO_LINKS = [
  {
    icon: Play,
    title: "Watch with ads",
    desc: "Pause ad at 3:00, mid-rolls at 4:00 & 8:00, chat with real timestamps",
    href: "/watch/vid_demo001?t=175000",
  },
  {
    icon: MessageSquareText,
    title: "Chat with video",
    desc: "Ask the Docker tutorial anything — answers carry clickable timestamps",
    href: "/watch/vid_demo004",
  },
  {
    icon: BadgeCheck,
    title: "Creator approvals",
    desc: "Review before → after frames, approve or reject each AI placement",
    href: "/studio/slots",
  },
  {
    icon: Upload,
    title: "Upload your own",
    desc: "13-step pipeline: probe → ASR → embeddings → inpaint → locked manifest",
    href: "/studio",
  },
];

export default function HomePage() {
  return (
    <div className="overflow-x-clip">
      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="container mx-auto grid items-center gap-10 px-4 py-14 lg:grid-cols-[1.05fr_1fr] lg:py-20">
        <div>
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            <Sparkles className="h-3.5 w-3.5" />
            Backblaze Generative Media Hackathon 2026
          </div>
          <h1 className="mb-5 text-5xl font-bold leading-[1.05] tracking-tight lg:text-6xl">
            Video that{" "}
            <span className="text-primary">answers questions</span>,
            sponsors itself, and proves it.
          </h1>
          <p className="mb-8 max-w-xl text-lg text-muted-foreground">
            BrandFrame is an AI-native video platform: semantic search with clickable
            timestamps, chat-with-video, three layers of disclosed AI ad placements — and
            a cryptographic manifest, WORM-locked on Backblaze B2, for every single one.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="lg" asChild>
              <Link href="/watch/vid_demo001?t=175000">
                <Play className="mr-2 h-4 w-4" /> Watch the demo
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="/search?q=how+do+I+center+a+div">
                <Search className="mr-2 h-4 w-4" /> Search moments
              </Link>
            </Button>
          </div>
          {/* stats strip */}
          <dl className="mt-10 grid max-w-md grid-cols-4 gap-4 border-t border-border pt-5">
            {[
              ["5", "demo videos"],
              ["21", "chapters"],
              ["3", "ad layers"],
              ["13", "AI steps"],
            ].map(([n, label]) => (
              <div key={label}>
                <dt className="text-2xl font-bold text-primary">{n}</dt>
                <dd className="text-xs text-muted-foreground">{label}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="relative">
          <img
            src="/brand/hero.webp"
            alt="Pixel-art creator studio: an AI scans a tutorial video and places a product into the frame"
            className="pixel-frame pixelated aspect-[21/9] w-full object-cover lg:aspect-auto"
          />
          <div className="absolute -bottom-4 left-4 flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs shadow-lg">
            <Timer className="h-3.5 w-3.5 text-primary" />
            <span>
              In-scene ad slots detected at <span className="font-mono text-primary">3:00</span> and{" "}
              <span className="font-mono text-primary">5:00</span> — creator-approved
            </span>
          </div>
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────── */}
      <section className="border-t border-border bg-card/30">
        <div className="container mx-auto px-4 py-16">
          <h2 className="mb-2 text-center text-3xl font-bold">The full loop, not a demo trick</h2>
          <p className="mx-auto mb-12 max-w-2xl text-center text-sm text-muted-foreground">
            Every feature below runs on real data in this repo — the demo corpus is seeded,
            the pipeline is 13 real steps, and the fallbacks are honest about what&apos;s live.
          </p>
          <div className="grid gap-8 md:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="group flex flex-col rounded-lg border border-border bg-card p-5 transition-colors hover:border-primary/50">
                <img
                  src={f.img}
                  alt={f.title}
                  className="pixel-frame pixelated mb-5 aspect-square w-full object-cover"
                />
                <f.icon className="mb-2 h-5 w-5 text-primary" />
                <h3 className="mb-2 text-lg font-semibold">{f.title}</h3>
                <p className="mb-4 flex-1 text-sm text-muted-foreground">{f.copy}</p>
                <Link
                  href={f.href}
                  className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                >
                  {f.cta} <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works: the 13-step pipeline ────────────────── */}
      <section className="container mx-auto px-4 py-16">
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <div>
            <h2 className="mb-3 text-3xl font-bold">Thirteen steps. One locked receipt.</h2>
            <p className="mb-8 text-sm text-muted-foreground">
              Upload a video and the Genblaze pipeline (Python, spawned server-side by
              Next.js) runs end-to-end. Each step logs JSONL to the studio UI in real time
              over SSE, then signs the manifest.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              {PIPELINE_GROUPS.map((g) => (
                <div key={g.title} className="rounded-md border border-border bg-card p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <g.icon className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-semibold">{g.title}</h3>
                  </div>
                  <div className="mb-2 flex flex-wrap gap-1">
                    {g.steps.map((s) => (
                      <code key={s} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                        {s}
                      </code>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">{g.blurb}</p>
                </div>
              ))}
            </div>
          </div>
          <img
            src="/brand/pipeline.webp"
            alt="Pixel-art conveyor belt carrying video frames through scan, listen, think, paint and vault stations"
            className="pixel-frame pixelated w-full"
          />
        </div>
      </section>

      {/* ── Ad engine three layers ────────────────────────────── */}
      <section className="border-t border-border bg-card/30">
        <div className="container mx-auto px-4 py-16">
          <h2 className="mb-2 text-center text-3xl font-bold">Ads that respect the viewer</h2>
          <p className="mx-auto mb-10 max-w-2xl text-center text-sm text-muted-foreground">
            Three layers, hard caps, and FTC-style disclosure on every surface. No
            100-ads-per-video spam — each placement needs a scene, a score, and a signature.
          </p>
          <div className="grid gap-6 md:grid-cols-3">
            {[
              {
                n: "01",
                title: "Intent overlays",
                body: "Search “coffee” and a BrewMate card appears — matched by embedding similarity to the query, threshold 0.3, one per query, always labeled Sponsored.",
              },
              {
                n: "02",
                title: "Natural-break mid-rolls",
                body: "A deterministic scorer finds pauses that align with scene cuts and topic shifts. Max one per 3 minutes, never in the first 60 seconds, skippable after 6.",
              },
              {
                n: "03",
                title: "In-scene pause ads",
                body: "The hero: a mug on a desk becomes a BrewMate mug for one paused frame — inpainted by Gemini, scored by a VL critic, approved by the creator, locked on B2.",
              },
            ].map((l) => (
              <div key={l.n} className="rounded-lg border border-border bg-card p-5">
                <span className="font-mono text-2xl font-bold text-primary/60">{l.n}</span>
                <h3 className="mb-2 mt-1 font-semibold">{l.title}</h3>
                <p className="text-sm text-muted-foreground">{l.body}</p>
              </div>
            ))}
          </div>
          <p className="mt-6 text-center font-mono text-xs text-muted-foreground">
            &quot;AI Ad · Why?&quot; — every generated placement links to its public
            provenance record.
          </p>
        </div>
      </section>

      {/* ── Try it live ───────────────────────────────────────── */}
      <section className="container mx-auto px-4 py-16">
        <h2 className="mb-8 text-center text-3xl font-bold">
          <MousePointerClick className="mr-2 inline h-7 w-7 text-primary" />
          Poke around — everything is live
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {DEMO_LINKS.map((d) => (
            <Link
              key={d.title}
              href={d.href}
              className="group rounded-lg border border-border bg-card p-5 transition-colors hover:border-primary/50"
            >
              <d.icon className="mb-3 h-6 w-6 text-primary" />
              <h3 className="mb-1 font-semibold">{d.title}</h3>
              <p className="text-xs text-muted-foreground">{d.desc}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* ── Trust note ───────────────────────────────────────── */}
      <section className="border-t border-border">
        <div className="container mx-auto px-4 py-10 text-center">
          <p className="mx-auto max-w-3xl text-xs leading-relaxed text-muted-foreground">
            BrandFrame discloses AI-generated ads per FTC 16 CFR Part 255 and the EU AI
            Act transparency tier. No faces, hands, or people are ever altered —
            placements are limited to inanimate surfaces, and every creative is
            cryptographically recorded with SHA-256 hashes on{" "}
            <a
              href="https://www.backblaze.com/cloud-storage"
              className="text-primary hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              Backblaze B2
            </a>{" "}
            with Object Lock COMPLIANCE retention.
          </p>
        </div>
      </section>
    </div>
  );
}
