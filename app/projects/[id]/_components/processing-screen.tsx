"use client";

import { Loader2 } from "lucide-react";
import { StepCard, type StepState } from "@/components/ui/step-card";
import { Button } from "@/components/ui/button";
import type { JobsResp } from "../_shared";

const PIPELINE_STEPS = [
  { type: "search", label: "Search & extract", hint: "Finding the right moments" },
  { type: "download", label: "Download videos", hint: "Pulling source files" },
  { type: "clip", label: "Generate clips", hint: "Cutting 4–5s clips" },
  { type: "match", label: "Match to script", hint: "Aligning clips to your text" },
] as const;

export function ProcessingScreen({
  jobs,
  onRetry,
}: {
  projectId: string;
  jobs: JobsResp | undefined;
  onRetry?: () => void;
}) {
  const mediaJobs = jobs?.media_jobs ?? [];
  const failedCount = mediaJobs.filter((j) => j.status === "failed").length;
  // "All done" means every pipeline step has settled (done or failed) AND the
  // match step has actually run — without match, the timeline is empty and the
  // workspace will never advance to the editor, so showing "complete" here
  // would lie. Steps with no jobs at all also block "complete".
  const allDone = PIPELINE_STEPS.every((step) => {
    const state = stateForStep(step.type, mediaJobs);
    return state === "done";
  });

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="text-center pt-4 pb-2">
        <div
          className={
            allDone
              ? "inline-grid h-16 w-16 place-items-center rounded-2xl bg-emerald-500/15 border border-emerald-500/30"
              : "inline-grid h-16 w-16 place-items-center rounded-2xl gradient-brand shadow-glow"
          }
        >
          {allDone ? (
            <span className="text-emerald-400 text-xl">✓</span>
          ) : (
            <Loader2 className="h-7 w-7 text-white animate-spin" />
          )}
        </div>
        <h2 className="mt-4 text-xl font-semibold text-fg">
          {allDone ? "Processing complete" : "Building your video"}
        </h2>
        <p className="mt-1 text-sm text-fg-muted">
          {allDone
            ? "Your scenes are ready to review."
            : "You can leave this page — we'll keep working in the background."}
        </p>
      </div>

      <div className="space-y-2">
        {PIPELINE_STEPS.map((step, i) => {
          const stat = statForStep(step.type, mediaJobs);
          const state = stateForStep(step.type, mediaJobs);
          const progress = progressForStep(step.type, mediaJobs);
          return (
            <StepCard
              key={step.type}
              index={i}
              label={step.label}
              hint={state === "running" ? step.hint : undefined}
              state={state}
              progress={progress}
              stat={stat}
            />
          );
        })}
      </div>

      {failedCount > 0 && (
        <div className="rounded-[10px] border border-danger/30 bg-danger/5 p-4 flex items-start gap-3">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-danger/15 text-danger">
            !
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-fg">
              {failedCount} job{failedCount === 1 ? "" : "s"} failed
            </p>
            <p className="text-xs text-fg-muted mt-0.5">
              Usually transient — try again, or remove the failing source.
            </p>
          </div>
          {onRetry && (
            <Button size="sm" variant="outline" onClick={onRetry}>
              Retry failed
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function jobsOfType(type: string, jobs: JobsResp["media_jobs"]) {
  return jobs.filter((j) => j.type === type);
}

function stateForStep(
  type: string,
  jobs: JobsResp["media_jobs"],
): StepState {
  const list = jobsOfType(type, jobs);
  if (list.length === 0) return "pending";
  const failed = list.filter((j) => j.status === "failed").length;
  const running = list.filter((j) => j.status === "running" || j.status === "queued").length;
  const done = list.filter((j) => j.status === "completed").length;
  if (running > 0) return "running";
  // Settle once nothing is in-flight. Partial success counts as "done" so the
  // pipeline can move on — otherwise a single permanent failure (e.g. a
  // geo-blocked video with no fallback left) would loop forever.
  if (done + failed === list.length) return done === 0 ? "failed" : "done";
  return "pending";
}

function progressForStep(type: string, jobs: JobsResp["media_jobs"]): number | undefined {
  const list = jobsOfType(type, jobs);
  if (list.length === 0) return undefined;
  const sum = list.reduce((s, j) => s + (j.progress ?? 0), 0);
  return Math.round(sum / list.length);
}

function statForStep(type: string, jobs: JobsResp["media_jobs"]): string | undefined {
  const list = jobsOfType(type, jobs);
  if (list.length === 0) return undefined;
  const done = list.filter((j) => j.status === "completed").length;
  const failed = list.filter((j) => j.status === "failed").length;
  return failed > 0 ? `${done}/${list.length} · ${failed} failed` : `${done}/${list.length}`;
}
