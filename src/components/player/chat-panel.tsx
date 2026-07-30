"use client";

import { useState, useRef, useEffect } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface ChatPanelProps {
  videoId: string;
}

export function ChatPanel({ videoId }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "Ask me anything about this video!" },
  ]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || streaming) return;

    const userMsg = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setStreaming(true);

    // Simulated streaming response
    const response = "Based on the video content, I can see that this tutorial covers the fundamentals. At timestamp **3:45**, there's a key example demonstrating this concept. Would you like me to elaborate on any specific section?";
    
    setTimeout(() => {
      setMessages((prev) => [...prev, { role: "assistant", content: response }]);
      setStreaming(false);
    }, 1000);
  };

  return (
    <div className="flex h-full flex-col rounded-lg border border-border bg-card">
      <div className="border-b border-border p-3">
        <h3 className="text-sm font-semibold">Chat with Video</h3>
      </div>

      <ScrollArea ref={scrollRef} className="flex-1 p-3">
        <div className="space-y-3">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`rounded-md p-2 text-sm ${
                msg.role === "assistant"
                  ? "bg-muted text-foreground"
                  : "bg-primary/10 text-foreground"
              }`}
            >
              {msg.content}
            </div>
          ))}
          {streaming && (
            <div className="rounded-md bg-muted p-2 text-sm text-muted-foreground animate-pulse">
              Thinking...
            </div>
          )}
        </div>
      </ScrollArea>

      <form onSubmit={handleSubmit} className="flex gap-2 border-t border-border p-3">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about this video..."
          disabled={streaming}
          className="flex-1"
        />
        <Button type="submit" size="icon" disabled={streaming}>
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}
