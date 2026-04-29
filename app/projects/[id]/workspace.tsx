"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { JobStepper } from "./job-stepper";
import { TimelineReview } from "./timeline-review";
import { ClipLibrary } from "./clip-library";
import { formatDuration } from "@/lib/utils";

interface ProjectResp {
  project: {
    id: string;
    title: string;
    transcript: string | null;
    voiceover_url: string | null;
    status: string;
    created_at: string;
    updated_at: string;
  };
  entities: Array<{ id: string; type: string; value: string }>;
  search_results: Array<{ id: string; title: string | null; channel_title: string | null; score: number; status: string; duration_seconds: number | null }>;
  video_sources: Array<{ id: string; title: string | null; status: string; youtube_video_id: string }>;
}

interface JobsResp {
  project_status: string | null;
  media_jobs: Array<{ id: string; type: string; status: string; progress: number; error: string | null; created_at: string; metadata: Record<string, unknown> }>;
  render_jobs: Array<{ id: string; status: string; progress: number; output_url: string | null; error: string | null; created_at: string }>;
}

export function ProjectWorkspace({ projectId }: { projectId: string }) {
  const qc = useQueryClient();

  const projectQ = useQuery<ProjectResp>({
    queryKey: ["project", projectId],
    queryFn: () => fetch(`/api/projects/${projectId}`).then((r) => r.json()),
  });

  const jobsQ = useQuery<JobsResp>({
    queryKey: ["project-jobs", projectId],
    queryFn: () => fetch(`/api/projects/${projectId}/jobs`).then((r) => r.json()),
    refetchInterval: (q) => {
      const d = q.state.data;
      if (!d) return 3000;
      const busy = d.media_jobs.some((j) => j.status === "queued" || j.status === "running")
                || d.render_jobs.some((j) => j.status === "queued" || j.status === "running");
      return busy ? 2000 : 8000;
    },
  });

  const [transcript, setTranscript] = useState<string>("");
  useEffect(() => {
    if (projectQ.data?.project) setTranscript(projectQ.data.project.transcript ?? "");
  }, [projectQ.data?.project?.id]);

  const saveTranscript = useMutation({
    mutationFn: async (value: string) => {
      const r = await fetch(`/api/projects/${projectId}/transcript`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: value }),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? `failed ${r.status}`);
      return r.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["project", projectId] }),
  });

  const startGenerate = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/generate`, { method: "POST" });
      if (!r.ok) throw new Error((await r.json()).error ?? `failed ${r.status}`);
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-jobs", projectId] });
      qc.invalidateQueries({ queryKey: ["project", projectId] });
    },
  });

  const startRender = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/render`, { method: "POST" });
      if (!r.ok) throw new Error((await r.json()).error ?? `failed ${r.status}`);
      return r.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["project-jobs", projectId] }),
  });

  const uploadVoiceover = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(`/api/projects/${projectId}/voiceover`, { method: "POST", body: fd });
      if (!r.ok) throw new Error((await r.json()).error ?? `failed ${r.status}`);
      return r.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["project", projectId] }),
  });

  if (projectQ.isLoading) return <div className="p-8">Loading…</div>;
  if (projectQ.isError || !projectQ.data?.project) {
    return <div className="p-8 text-destructive">Project not found.</div>;
  }
  const project = projectQ.data.project;
  const jobs = jobsQ.data;
  const latestRender = jobs?.render_jobs?.[0];
  const isBusy = (jobs?.media_jobs ?? []).some((j) => j.status === "queued" || j.status === "running");

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs text-muted-foreground"><Link href="/dashboard">← Dashboard</Link></p>
          <h1 className="text-2xl font-semibold tracking-tight">{project.title}</h1>
          <div className="mt-2 flex items-center gap-2">
            <Badge>{project.status.replace(/_/g, " ")}</Badge>
            <span className="text-xs text-muted-foreground">Updated {new Date(project.updated_at).toLocaleString()}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <Link href={`/projects/${project.id}/clips`}>
            <Button variant="outline">All clips</Button>
          </Link>
          <Button
            onClick={() => startGenerate.mutate()}
            disabled={isBusy || !transcript.trim() || startGenerate.isPending}
          >
            {isBusy ? "Generating…" : "Start generation"}
          </Button>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Transcript</CardTitle>
            <CardDescription>Paste a script. We use this for entity extraction and matching.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              rows={10}
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              placeholder="Today on the channel, we're talking about..."
            />
            <div className="flex items-center gap-3">
              <Button
                variant="secondary"
                onClick={() => saveTranscript.mutate(transcript)}
                disabled={saveTranscript.isPending}
              >
                {saveTranscript.isPending ? "Saving…" : "Save transcript"}
              </Button>
              {saveTranscript.error && <p className="text-xs text-destructive">{(saveTranscript.error as Error).message}</p>}
              {saveTranscript.isSuccess && <p className="text-xs text-muted-foreground">Saved.</p>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Voiceover</CardTitle>
            <CardDescription>Optional audio bed — included in the final render.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="vo">Upload audio</Label>
              <Input
                id="vo"
                type="file"
                accept="audio/*"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadVoiceover.mutate(f);
                }}
              />
            </div>
            {uploadVoiceover.error && <p className="text-xs text-destructive">{(uploadVoiceover.error as Error).message}</p>}
            {project.voiceover_url && (
              <audio controls src={project.voiceover_url} className="w-full" />
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pipeline</CardTitle>
          <CardDescription>Live status of every step.</CardDescription>
        </CardHeader>
        <CardContent>
          <JobStepper jobs={jobs?.media_jobs ?? []} />
        </CardContent>
      </Card>

      {projectQ.data.entities.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Extracted entities</CardTitle>
            <CardDescription>{projectQ.data.entities.length} found</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {projectQ.data.entities.map((e) => (
                <Badge key={e.id} variant="secondary">{e.type}: {e.value}</Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {projectQ.data.video_sources.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Source videos</CardTitle>
            <CardDescription>{projectQ.data.video_sources.length} downloaded</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {projectQ.data.video_sources.map((s) => (
              <div key={s.id} className="flex items-center justify-between text-sm">
                <span className="truncate">{s.title ?? s.youtube_video_id}</span>
                <Badge variant="outline">{s.status}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <ClipLibrary projectId={projectId} />

      <TimelineReview projectId={projectId} />

      <Card>
        <CardHeader>
          <CardTitle>Render</CardTitle>
          <CardDescription>Approve the timeline, then render.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Button onClick={() => startRender.mutate()} disabled={startRender.isPending}>
              {startRender.isPending ? "Queuing…" : "Start render"}
            </Button>
            {startRender.error && <p className="text-xs text-destructive">{(startRender.error as Error).message}</p>}
          </div>
          {latestRender && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span>Latest: {new Date(latestRender.created_at).toLocaleString()}</span>
                <Badge variant={
                  latestRender.status === "completed" ? "success"
                  : latestRender.status === "failed" ? "destructive"
                  : "default"
                }>{latestRender.status}</Badge>
              </div>
              <Progress value={latestRender.progress} />
              {latestRender.error && <p className="text-xs text-destructive">{latestRender.error}</p>}
              {latestRender.output_url && (
                <div className="space-y-2">
                  <video src={latestRender.output_url} controls className="w-full rounded-md border border-border" />
                  <a href={latestRender.output_url} className="text-sm underline" target="_blank" rel="noreferrer">Download MP4</a>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Separator />
      <p className="text-xs text-muted-foreground">
        Project ID: {project.id} · {formatDuration(project.transcript?.length ? project.transcript.length / 15 : 0)} estimated voiceover
      </p>
    </div>
  );
}
