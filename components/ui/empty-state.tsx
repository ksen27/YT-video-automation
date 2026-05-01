import * as React from "react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center py-16 px-6 rounded-[14px] border border-dashed border-border bg-surface/40",
        className,
      )}
    >
      {icon && (
        <div className="grid h-12 w-12 place-items-center rounded-full bg-surface-hover text-fg-muted">
          {icon}
        </div>
      )}
      <h3 className="mt-4 text-base font-semibold text-fg">{title}</h3>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-fg-muted">{description}</p>
      )}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
