import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const chipVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 h-6 text-xs font-medium transition-colors",
  {
    variants: {
      tone: {
        keyword: "border-brand-500/30 bg-brand-500/10 text-brand-300",
        person: "border-violet-500/30 bg-violet-500/10 text-violet-400",
        place: "border-cyan-400/30 bg-accent-cyan/10 text-accent-cyan",
        topic: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
        warning: "border-amber-500/30 bg-amber-500/10 text-amber-400",
        danger: "border-danger/30 bg-danger/10 text-danger",
        success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
        neutral: "border-border bg-surface text-fg-muted",
      },
      interactive: {
        true: "cursor-pointer hover:brightness-125",
        false: "",
      },
    },
    defaultVariants: { tone: "neutral", interactive: false },
  },
);

export interface ChipProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof chipVariants> {
  icon?: React.ReactNode;
  confidence?: number; // 0..1
}

export function Chip({
  className,
  tone,
  interactive,
  icon,
  confidence,
  children,
  ...rest
}: ChipProps) {
  return (
    <span className={cn(chipVariants({ tone, interactive }), className)} {...rest}>
      {icon}
      <span className="truncate">{children}</span>
      {confidence != null && (
        <span className="ml-0.5 text-[10px] tabular-nums opacity-70">
          {Math.round(confidence * 100)}%
        </span>
      )}
    </span>
  );
}

export { chipVariants };
