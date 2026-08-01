"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useChat } from "ai/react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SEEK_EVENT } from "./player";

interface ChatPanelProps {
  videoId: string;
}

/**
 * Render assistant text with:
 *  - <ts ms="123456">2:03</ts>  → clickable seek chip
 *  - **bold**                   → <strong>
 */
function MessageContent({ content, videoId }: { content: string; videoId: string }) {
  const router = useRouter();

  const seekTo = (ms: number) => {
    window.dispatchEvent(new CustomEvent(SEEK_EVENT, { detail: { ms } }));
    router.push(`/watch/${videoId}?t=${ms}`, { scroll: false });
  };

  const nodes: React.ReactNode[] = [];
  // Split on ts tags first, then inline bold within the remaining text.
  const tsRe = /<ts\s+ms="(\d+)"[^>]*>([\s\S]*?)<\/ts>/g;
  let last = 0;
  let key = 0;
  for (const m of content.matchAll(tsRe)) {
    const idx = m.index!;
    if (idx > last) nodes.push(...renderInline(content.slice(last, idx), key, (k) => (key = k)));
    const ms = parseInt(m[1], 10);
    nodes.push(
      <button
        key={`ts-${key++}`}
        onClick={() => seekTo(ms)}
        className="mx-0.5 inline-flex items-center rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-primary hover:bg-primary/20"
        title={`Jump to ${m[2]}`}
      >
        {m[2]}
      </button>
    );
    last = idx + m[0].length;
  }
  if (last < content.length) nodes.push(...renderInline(content.slice(last), key, (k) => (key = k)));

  return <span className="whitespace-pre-wrap break-words">{nodes}</span>;
}

/** Bold-inline rendering, preserving newlines via whitespace-pre-wrap on parent. */
function renderInline(
  text: string,
  keyStart: number,
  setKey: (k: number) => void
): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let key = keyStart;
  const boldRe = /\*\*([^*]+)\*\*/g;
  let last = 0;
  for (const m of text.matchAll(boldRe)) {
    const idx = m.index!;
    if (idx > last) out.push(text.slice(last, idx));
    out.push(<strong key={`b-${key++}`}>{m[1]}</strong>);
    last = idx + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  setKey(key);
  return out;
}

export function ChatPanel({ videoId }: ChatPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat({
    api: "/api/chat",
    streamProtocol: "text",
    body: { videoId },
    initialMessages: [
      {
        id: "welcome",
        role: "assistant",
        content: "Ask me anything about this video — I'll answer with clickable timestamps.",
      },
    ],
  });

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const waiting = isLoading && messages[messages.length - 1]?.role === "user";

  return (
    <div className="flex h-[480px] flex-col rounded-lg border border-border bg-card lg:h-full">
      <ScrollArea ref={scrollRef} className="flex-1 p-3">
        <div className="space-y-3">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`rounded-md p-2 text-sm ${
                msg.role === "assistant" ? "bg-muted text-foreground" : "ml-6 bg-primary/10 text-foreground"
              }`}
            >
              {msg.role === "assistant" ? (
                <MessageContent content={msg.content} videoId={videoId} />
              ) : (
                <span className="whitespace-pre-wrap break-words">{msg.content}</span>
              )}
            </div>
          ))}
          {waiting && (
            <div className="animate-pulse rounded-md bg-muted p-2 text-sm text-muted-foreground">
              Thinking…
            </div>
          )}
        </div>
      </ScrollArea>

      <form onSubmit={handleSubmit} className="flex gap-2 border-t border-border p-3">
        <Input
          value={input}
          onChange={handleInputChange}
          placeholder="Ask about this video…"
          disabled={isLoading}
          className="flex-1"
        />
        <Button type="submit" size="icon" disabled={isLoading || !input.trim()} aria-label="Send message">
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}
