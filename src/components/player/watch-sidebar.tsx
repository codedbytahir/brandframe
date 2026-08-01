"use client";

import { useRouter } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChatPanel } from "./chat-panel";
import { SEEK_EVENT } from "./player";
import { formatTimestamp } from "@/lib/utils";

export interface SidebarSegment {
  id: string;
  index: number;
  startMs: number;
  endMs: number;
  topic: string | null;
  transcript: string;
}

export interface SidebarVideoMeta {
  id: string;
  title: string;
  status: string;
  durationMs: number | null;
  sizeBytes: number;
  createdAt: string;
  segmentCount: number;
}

export function WatchSidebar({
  videoId,
  segments,
  meta,
}: {
  videoId: string;
  segments: SidebarSegment[];
  meta: SidebarVideoMeta;
}) {
  const router = useRouter();

  const seekTo = (ms: number) => {
    window.dispatchEvent(new CustomEvent(SEEK_EVENT, { detail: { ms } }));
    router.push(`/watch/${videoId}?t=${ms}`, { scroll: false });
  };

  return (
    <Tabs defaultValue="chat" className="flex h-full w-full flex-col">
      <TabsList className="grid w-full grid-cols-3">
        <TabsTrigger value="chat">AI Chat</TabsTrigger>
        <TabsTrigger value="chapters">Chapters</TabsTrigger>
        <TabsTrigger value="about">About</TabsTrigger>
      </TabsList>

      <TabsContent value="chat" className="flex-1 data-[state=inactive]:hidden" forceMount>
        <ChatPanel videoId={videoId} />
      </TabsContent>

      <TabsContent value="chapters" className="flex-1">
        <ScrollArea className="h-[480px] pr-2 lg:h-[520px]">
          <div className="space-y-1">
            {segments.length === 0 && (
              <p className="p-2 text-sm text-muted-foreground">
                No chapters yet — they appear after the pipeline finishes.
              </p>
            )}
            {segments.map((seg) => (
              <button
                key={seg.id}
                onClick={() => seekTo(seg.startMs)}
                className="flex w-full items-start gap-3 rounded-md bg-card p-2 text-left text-sm hover:bg-accent"
              >
                <span className="mt-0.5 shrink-0 font-mono text-xs text-primary">
                  {formatTimestamp(seg.startMs)}
                </span>
                <span>
                  <span className="block font-medium">
                    {seg.topic ?? `Chapter ${seg.index + 1}`}
                  </span>
                  <span className="line-clamp-2 text-xs text-muted-foreground">
                    {seg.transcript}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </ScrollArea>
      </TabsContent>

      <TabsContent value="about" className="flex-1">
        <div className="space-y-3 rounded-md bg-card p-3 text-sm">
          <div>
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Status</span>
            <div className="mt-1">
              <Badge variant={meta.status === "ready" ? "default" : "secondary"}>{meta.status}</Badge>
            </div>
          </div>
          <div>
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Duration</span>
            <p className="mt-1 font-mono text-xs">{meta.durationMs ? formatTimestamp(meta.durationMs) : "—"}</p>
          </div>
          <div>
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Size</span>
            <p className="mt-1 font-mono text-xs">{(meta.sizeBytes / 1_000_000).toFixed(1)} MB</p>
          </div>
          <div>
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Segments</span>
            <p className="mt-1 font-mono text-xs">{meta.segmentCount}</p>
          </div>
          <div>
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Uploaded</span>
            <p className="mt-1 font-mono text-xs">{meta.createdAt}</p>
          </div>
          <div className="border-t border-border pt-3 text-xs text-muted-foreground">
            Provenance-tracked with Backblaze B2 Object Lock.{" "}
            <a href={`/verify/${videoId}`} className="text-primary hover:underline">
              Verify this video →
            </a>
          </div>
        </div>
      </TabsContent>
    </Tabs>
  );
}
