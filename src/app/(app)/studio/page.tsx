"use client";

import { useState } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent } from "@/components/ui/card";

export default function StudioPage() {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [videos, setVideos] = useState<Array<{ id: string; title: string; status: string }>>([]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setProgress(0);

    // Simulate upload progress
    for (let i = 0; i <= 100; i += 10) {
      await new Promise((r) => setTimeout(r, 200));
      setProgress(i);
    }

    setVideos((prev) => [
      { id: `vid_${Math.random().toString(36).slice(2, 10)}`, title: file.name, status: "uploaded" },
      ...prev,
    ]);
    setUploading(false);
    setProgress(0);
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="mb-6 text-3xl font-bold">Studio</h1>

      <Card className="mb-8">
        <CardContent className="p-8">
          <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-border bg-muted/50 p-12">
            <Upload className="mb-4 h-8 w-8 text-muted-foreground" />
            <p className="mb-2 text-sm text-muted-foreground">
              Drag & drop your video here, or click to browse
            </p>
            <p className="mb-4 text-xs text-muted-foreground">
              Max 5GB · MP4, MOV, WebM
            </p>
            <label>
              <input
                type="file"
                accept="video/*"
                className="hidden"
                onChange={handleUpload}
                disabled={uploading}
              />
              <Button variant="outline" disabled={uploading} asChild>
                <span>{uploading ? "Uploading..." : "Select Video"}</span>
              </Button>
            </label>
          </div>
          {uploading && (
            <div className="mt-4">
              <Progress value={progress} className="h-2" />
              <p className="mt-2 text-center text-xs text-muted-foreground">{progress}%</p>
            </div>
          )}
        </CardContent>
      </Card>

      {videos.length > 0 && (
        <div>
          <h2 className="mb-4 text-xl font-semibold">Your Videos</h2>
          <div className="space-y-2">
            {videos.map((v) => (
              <div key={v.id} className="flex items-center justify-between rounded-md bg-card p-3">
                <span className="text-sm">{v.title}</span>
                <span className="text-xs text-muted-foreground">{v.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
