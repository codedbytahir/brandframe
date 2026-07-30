import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Player } from "@/components/player/player";
import { ChatPanel } from "@/components/player/chat-panel";

interface WatchPageProps {
  params: Promise<{ videoId: string }>;
  searchParams: Promise<{ t?: string }>;
}

export default async function WatchPage({ params, searchParams }: WatchPageProps) {
  const { videoId } = await params;
  const { t } = await searchParams;
  const startTime = t ? parseInt(t) : 0;

  return (
    <div className="container mx-auto px-4 py-6">
      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="flex-1">
          <Suspense fallback={<Skeleton className="aspect-video w-full" />}>
            <Player videoId={videoId} startTime={startTime} />
          </Suspense>

          <div className="mt-4">
            <h1 className="text-2xl font-bold">Sample Tutorial Video</h1>
            <div className="mt-2 flex items-center gap-2">
              <Badge variant="secondary">Tutorial</Badge>
              <span className="text-sm text-muted-foreground">12:34 • 1.2k views</span>
            </div>
          </div>

          <div className="mt-6">
            <h2 className="mb-3 text-lg font-semibold">Chapters</h2>
            <div className="space-y-2">
              {[
                { time: "0:00", title: "Introduction" },
                { time: "2:30", title: "Setup & Configuration" },
                { time: "5:45", title: "Core Concepts" },
                { time: "8:00", title: "Advanced Features" },
                { time: "10:30", title: "Summary" },
              ].map((ch) => (
                <div key={ch.time} className="flex items-center gap-3 rounded-md bg-card p-2 text-sm hover:bg-accent cursor-pointer">
                  <span className="font-mono text-xs text-muted-foreground">{ch.time}</span>
                  <span>{ch.title}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="w-full lg:w-80">
          <ChatPanel videoId={videoId} />
        </div>
      </div>
    </div>
  );
}
