"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Upload, Play, CheckCircle, XCircle, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

/** 15 minutes in milliseconds */
const STALE_THRESHOLD_MS = 15 * 60 * 1000;

interface VideoRecord {
  id: string;
  title: string;
  filename: string;
  status: string;
  uploadProgress: number;
  updatedAt?: string;
  staleMessage?: string;
}

interface PipelineStep {
  step: string;
  status: string;
  progress: number;
  message: string;
}

export default function StudioPage() {
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [videos, setVideos] = useState<VideoRecord[]>([]);
  const [pipelineSteps, setPipelineSteps] = useState<PipelineStep[]>([]);
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const eventSourceRef = useRef<EventSource | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Cleanup SSE on unmount
  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  // Guard: mark stale videos (uploading/processing > 15 min) as failed
  useEffect(() => {
    setVideos((prev) =>
      prev.map((v) => {
        if (v.status !== "uploading" && v.status !== "processing") return v;
        if (!v.updatedAt) return v;
        const age = Date.now() - new Date(v.updatedAt).getTime();
        if (age > STALE_THRESHOLD_MS) {
          return { ...v, status: "failed", staleMessage: "Pipeline never started — try re-uploading" };
        }
        return v;
      })
    );
  }, []);

  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadProgress(0);
    setPipelineSteps([]);

    try {
      // Step 1: Get presigned URL
      const uploadRes = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type,
          sizeBytes: file.size,
          title: title || file.name,
        }),
      });
      const uploadData = await uploadRes.json();

      if (!uploadData.uploadUrl && !uploadData.isDemo) {
        throw new Error(uploadData.error || "Failed to get upload URL");
      }

      const videoId = uploadData.videoId;
      setActiveVideoId(videoId);

      // Add to video list
      const record: VideoRecord = {
        id: videoId,
        title: title || file.name,
        filename: file.name,
        status: uploadData.isDemo ? "processing" : "uploading",
        uploadProgress: 0,
        updatedAt: new Date().toISOString(),
      };
      setVideos((prev) => [record, ...prev]);

      // Step 2: Upload to B2 via XHR PUT (or simulate in demo mode)
      if (uploadData.isDemo) {
        // Simulate upload progress
        for (let i = 0; i <= 100; i += 10) {
          await new Promise((r) => setTimeout(r, 150));
          setUploadProgress(i);
          setVideos((prev) =>
            prev.map((v) => (v.id === videoId ? { ...v, uploadProgress: i } : v))
          );
        }
        // Simulate pipeline steps
        simulatePipeline(videoId);
      } else {
        // Real XHR PUT to B2 with progress
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("PUT", uploadData.uploadUrl, true);
          xhr.setRequestHeader("Content-Type", file.type);

          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
              const pct = Math.round((event.loaded / event.total) * 100);
              setUploadProgress(pct);
              setVideos((prev) =>
                prev.map((v) => (v.id === videoId ? { ...v, uploadProgress: pct } : v))
              );
            }
          };

          xhr.onload = async () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              setUploadProgress(100);
              setVideos((prev) =>
                prev.map((v) => (v.id === videoId ? { ...v, status: "processing", uploadProgress: 100 } : v))
              );
              // Trigger the ingest pipeline on the server
              try {
                const pipelineRes = await fetch(`/api/pipelines/${videoId}`, { method: "POST" });
                if (!pipelineRes.ok) {
                  const errData = await pipelineRes.json().catch(() => ({ error: "Pipeline start failed" }));
                  setVideos((prev) =>
                    prev.map((v) => (v.id === videoId ? { ...v, status: "failed" } : v))
                  );
                  reject(new Error(errData.error || `Pipeline start failed: ${pipelineRes.status}`));
                  return;
                }
              } catch (err) {
                setVideos((prev) =>
                  prev.map((v) => (v.id === videoId ? { ...v, status: "failed" } : v))
                );
                reject(err instanceof Error ? err : new Error("Pipeline start failed"));
                return;
              }
              // Start SSE for pipeline progress
              startPipelineSSE(videoId);
              resolve();
            } else {
              reject(new Error(`Upload failed: ${xhr.status}`));
            }
          };

          xhr.onerror = () => reject(new Error("Upload failed"));
          xhr.send(file);
        });
      }
    } catch (error: any) {
      console.error("Upload error:", error);
      setVideos((prev) =>
        prev.map((v) =>
          v.id === activeVideoId ? { ...v, status: "failed" } : v
        )
      );
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [title, activeVideoId]);

  const simulatePipeline = (videoId: string) => {
    const steps = [
      { step: "probe", progress: 12, message: "Source probed" },
      { step: "transcode", progress: 25, message: "HLS + poster uploaded" },
      { step: "asr", progress: 40, message: "ASR completed" },
      { step: "scenes", progress: 55, message: "Scenes + keyframes extracted" },
      { step: "vl-caption", progress: 60, message: "Keyframes captioned" },
      { step: "chunk", progress: 65, message: "Chunks created" },
      { step: "embed", progress: 80, message: "Embeddings generated" },
      { step: "slots", progress: 92, message: "Ad slots detected" },
      { step: "inpaint", progress: 96, message: "Slots inpainted" },
      { step: "critic", progress: 98, message: "Critic passed" },
      { step: "manifest", progress: 100, message: "Manifest uploaded to B2" },
    ];

    steps.forEach((s, i) => {
      setTimeout(() => {
        setPipelineSteps((prev) => [...prev, { ...s, status: "completed" }]);
        setVideos((prev) =>
          prev.map((v) =>
            v.id === videoId
              ? { ...v, status: s.progress === 100 ? "ready" : "processing" }
              : v
          )
        );
      }, (i + 1) * 1500);
    });
  };

  const startPipelineSSE = (videoId: string) => {
    eventSourceRef.current?.close();
    const es = new EventSource(`/api/pipelines/${videoId}`);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        // Terminal "done" event from the server
        if (data.done) {
          const finalStatus = data.status || "ready";
          setVideos((prev) =>
            prev.map((v) =>
              v.id === videoId ? { ...v, status: finalStatus } : v
            )
          );
          es.close();
          return;
        }

        if (data.line) {
          const parsed = JSON.parse(data.line);
          if (parsed.event === "progress") {
            setPipelineSteps((prev) => {
              const existing = prev.find((s) => s.step === parsed.step);
              if (existing) {
                return prev.map((s) =>
                  s.step === parsed.step
                    ? { ...s, status: parsed.status, progress: parsed.progress, message: parsed.message }
                    : s
                );
              }
              return [...prev, { step: parsed.step, status: parsed.status, progress: parsed.progress, message: parsed.message }];
            });

            setVideos((prev) =>
              prev.map((v) =>
                v.id === videoId
                  ? { ...v, status: parsed.progress >= 100 ? "ready" : "processing" }
                  : v
              )
            );
          }
          if (parsed.event === "complete") {
            // Server will send "done" shortly; let that handle cleanup
          }
        }
      } catch {}
    };

    es.onerror = () => {
      es.close();
    };
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case "uploading": return <Badge variant="warning">Uploading</Badge>;
      case "processing": return <Badge variant="outline" className="flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Processing</Badge>;
      case "ready": return <Badge variant="success">Ready</Badge>;
      case "failed": return <Badge variant="danger">Failed</Badge>;
      default: return <Badge variant="secondary">{status}</Badge>;
    }
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-bold">Studio</h1>
        <a
          href="/studio/slots"
          className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent"
        >
          Placement approvals →
        </a>
      </div>

      {/* Upload Card */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Upload Video</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-4">
            <Input
              placeholder="Video title (optional)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mb-4"
            />
          </div>
          <div
            className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-border bg-muted/50 p-12 cursor-pointer hover:bg-muted/80 transition-colors"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="mb-4 h-8 w-8 text-muted-foreground" />
            <p className="mb-2 text-sm text-muted-foreground">
              Drag & drop your video here, or click to browse
            </p>
            <p className="mb-4 text-xs text-muted-foreground">
              Max 5GB · MP4, MOV, WebM
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={handleUpload}
              disabled={uploading}
            />
            <Button variant="outline" disabled={uploading} asChild>
              <span>{uploading ? "Uploading..." : "Select Video"}</span>
            </Button>
          </div>
          {uploading && (
            <div className="mt-4">
              <Progress value={uploadProgress} className="h-2" />
              <p className="mt-2 text-center text-xs text-muted-foreground">
                {uploadProgress}% uploaded
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pipeline Progress */}
      {pipelineSteps.length > 0 && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Pipeline Progress
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {pipelineSteps.map((step) => (
                <div key={step.step} className="flex items-center gap-3">
                  {step.status === "completed" ? (
                    <CheckCircle className="h-4 w-4 flex-shrink-0 text-emerald-500" />
                  ) : step.status === "failed" ? (
                    <XCircle className="h-4 w-4 flex-shrink-0 text-red-500" />
                  ) : (
                    <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin text-primary" />
                  )}
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium capitalize">{step.step}</span>
                      <span className="text-xs text-muted-foreground">{step.progress}%</span>
                    </div>
                    <Progress value={step.progress} className="mt-1 h-1.5" />
                    <p className="mt-0.5 text-xs text-muted-foreground">{step.message}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Video List */}
      {videos.length > 0 && (
        <div>
          <h2 className="mb-4 text-xl font-semibold">Your Videos</h2>
          <div className="space-y-3">
            {videos.map((v) => (
              <Card key={v.id}>
                <CardContent className="flex items-center gap-4 p-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-md bg-muted">
                    <Play className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium">{v.title}</p>
                    <p className="text-xs text-muted-foreground font-mono">{v.id}</p>
                    {v.staleMessage && (
                      <p className="mt-1 flex items-center gap-1 text-xs text-amber-500">
                        <AlertTriangle className="h-3 w-3" />
                        {v.staleMessage}
                      </p>
                    )}
                    {v.status === "processing" && (
                      <Progress value={v.uploadProgress || 0} className="mt-1 h-1" />
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {statusBadge(v.status)}
                    {v.status === "ready" && (
                      <Button variant="outline" size="sm" asChild>
                        <a href={`/watch/${v.id}`}>Watch</a>
                      </Button>
                    )}
                    <a href={`/verify/${v.id}`}>
                      <Button variant="ghost" size="sm">Verify</Button>
                    </a>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
