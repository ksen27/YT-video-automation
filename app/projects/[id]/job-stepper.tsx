"use client";

import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Clock, Loader2, XCircle } from "lucide-react";

interface MediaJob {
  id: string;
  type: string;
  status: string;
  progress: number;
  error: string | null;
  created_at: string;
}

const STEPS = [
  { type: "search",   label: "Search & extract" },
  { type: "download", label: "Download videos" },
  { type: "clip",     label: "Generate clips" },
  { type: "match",    label: "Match to script" },
  { type: "render",   label: "Render" },
] as const;

export function JobStepper({ jobs }: { jobs: MediaJob[] }) {
  // Aggregate per type — show the latest job of each type
  const latestByType = new Map<string, MediaJob>();
  for (const j of jobs) {
    const prev = latestByType.get(j.type);
    if (!prev || new Date(j.created_at) > new Date(prev.created_at)) {
      latestByType.set(j.type, j);
    }
  }
  const allByType = new Map<string, MediaJob[]>();
  for (const j of jobs) {
    const arr = allByType.get(j.type) ?? [];
    arr.push(j);
    allByType.set(j.type, arr);
  }

  return (
    <div className="space-y-4">
      {STEPS.map((step) => {
        const job = latestByType.get(step.type);
        const all = allByType.get(step.type) ?? [];
        const total = all.length;
        const done = all.filter((j) => j.status === "completed").length;
        const failed = all.filter((j) => j.status === "failed").length;
        const running = all.filter((j) => j.status === "running" || j.status === "queued").length;
        const avgProgress = total > 0
          ? Math.round(all.reduce((s, j) => s + (j.progress ?? 0), 0) / total)
          : 0;

        let icon = <Clock className="h-4 w-4 text-muted-foreground" />;
        if (job?.status === "completed" && failed === 0 && running === 0) {
          icon = <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
        } else if (job?.status === "running" || running > 0) {
          icon = <Loader2 className="h-4 w-4 animate-spin text-primary" />;
        } else if (job?.status === "failed" || failed > 0) {
          icon = <XCircle className="h-4 w-4 text-destructive" />;
        }

        return (
          <div key={step.type} className="space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2">{icon}<strong>{step.label}</strong></span>
              <span className="flex items-center gap-2">
                {total > 0 && <Badge variant="outline">{done}/{total}{failed ? ` · ${failed} failed` : ""}</Badge>}
                {job && <span className="text-xs text-muted-foreground">{job.status}</span>}
              </span>
            </div>
            <Progress value={total > 0 ? avgProgress : (job?.progress ?? 0)} />
            {job?.error && <p className="text-xs text-destructive">{job.error}</p>}
          </div>
        );
      })}
    </div>
  );
}
