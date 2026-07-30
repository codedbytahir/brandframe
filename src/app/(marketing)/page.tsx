import Link from "next/link";
import { Search, Film, Shield, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <div className="container mx-auto px-4 py-12">
      <section className="mb-16 text-center">
        <h1 className="mb-4 text-5xl font-bold tracking-tight">
          AI-Native{" "}
          <span className="text-primary">Video Platform</span>
        </h1>
        <p className="mx-auto mb-8 max-w-2xl text-lg text-muted-foreground">
          Semantic search, chat-with-video, and provenance-tracked in-scene pause ads.
          Built for the Backblaze Generative Media Hackathon.
        </p>
        <div className="flex items-center justify-center gap-4">
          <Link href="/search">
            <Button size="lg">Search Videos</Button>
          </Link>
          <Link href="/studio">
            <Button variant="outline" size="lg">Upload Video</Button>
          </Link>
        </div>
      </section>

      <section className="grid gap-6 md:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-6">
          <Search className="mb-3 h-8 w-8 text-primary" />
          <h3 className="mb-2 text-lg font-semibold">Semantic Search</h3>
          <p className="text-sm text-muted-foreground">
            Jump to the exact second in any video. Ask questions, get timestamped answers with AI-powered precision.
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-6">
          <Film className="mb-3 h-8 w-8 text-primary" />
          <h3 className="mb-2 text-lg font-semibold">Chat With Video</h3>
          <p className="text-sm text-muted-foreground">
            Ask follow-up questions against an AI overview grounded in transcribed and visual chunks.
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-6">
          <Shield className="mb-3 h-8 w-8 text-primary" />
          <h3 className="mb-2 text-lg font-semibold">Provenance Tracking</h3>
          <p className="text-sm text-muted-foreground">
            Every AI alteration is recorded in a SHA-256 Genblaze manifest, WORM-locked on Backblaze B2.
          </p>
        </div>
      </section>

      <section className="mt-16">
        <div className="rounded-lg border border-border bg-card p-6">
          <div className="mb-4 flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-semibold">Demo Video</h2>
          </div>
          <div className="aspect-video rounded-md bg-muted">
            <video
              className="h-full w-full rounded-md"
              controls
              poster="https://test-streams.mux.dev/x36xhzz/thumb.jpg"
            >
              <source src="https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8" type="application/x-mpegURL" />
            </video>
          </div>
        </div>
      </section>
    </div>
  );
}
