"use client";

import * as React from "react";
import { CheckCircle2, Loader2, Circle, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export type StepState = "pending" | "running" | "done" | "failed";

export interface StepCardProps {
  index: number;
  label: string;
  hint?: string;
  state: StepState;
  progress?: number; // 0..100
  stat?: string;
  icon?: React.ReactNode;
  className?: string;
}

export function StepCard({
  index,
  label,
  hint,
  state,
  progress,
  stat,
  icon,
  className,
}: StepCardProps) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-[10px] border bg-surface p-3 transition-colors",
        state === "running" && "border-brand-500/50 shadow-[0_0_0_1px_rgba(99,102,241,0.25)]",
        state === "done" && "border-emerald-500/30",
        state === "failed" && "border-danger/40",
        state === "pending" && "border-border",
        className,
      )}
    >
      <div
        className={cn(
          "mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border",
          state === "done" && "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
          state === "running" && "border-brand-500/40 bg-brand-500/10 text-brand-300",
          state === "failed" && "border-danger/40 bg-danger/10 text-danger",
          state === "pending" && "border-border text-fg-subtle",
        )}
      >
        <StepIcon state={state} fallback={icon} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs tabular-nums text-fg-subtle">
            {String(index + 1).padStart(2, "0")}
          </span>
          <span
            className={cn(
              "text-sm font-medium truncate",
              state === "pending" && "text-fg-muted",
            )}
          >
            {label}
          </span>
          {stat && (
            <span className="ml-auto text-[11px] tabular-nums text-fg-subtle shrink-0">
              {stat}
            </span>
          )}
        </div>
        {hint && <p className="text-xs text-fg-subtle mt-0.5 truncate">{hint}</p>}
        {state === "running" && progress != null && (
          <div className="mt-2 h-1 rounded-full bg-bg-elevated overflow-hidden">
            <div
              className="h-full gradient-brand transition-[width] duration-500"
              style={{ width: `${Math.max(4, Math.min(100, progress))}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function StepIcon({ state, fallback }: { state: StepState; fallback?: React.ReactNode }) {
  if (state === "done") return <CheckCircle2 className="h-4 w-4" />;
  if (state === "running") return <Loader2 className="h-4 w-4 animate-spin" />;
  if (state === "failed") return <AlertCircle className="h-4 w-4" />;
  return <>{fallback ?? <Circle className="h-4 w-4" />}</>;
}
