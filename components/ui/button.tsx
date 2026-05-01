"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-brand-600 text-white shadow-sm hover:bg-brand-700",
        gradient:
          "gradient-brand text-white shadow-md hover:shadow-glow active:opacity-90",
        soft: "bg-brand-500/10 text-brand-300 hover:bg-brand-500/20",
        destructive: "bg-danger text-white hover:bg-danger/90",
        outline:
          "border border-border bg-transparent text-fg hover:bg-surface-hover hover:border-border-strong",
        secondary:
          "bg-surface-hover text-fg hover:bg-surface-hover/80",
        ghost: "text-fg hover:bg-surface-hover",
        link: "text-brand-400 underline-offset-4 hover:underline",
      },
      size: {
        xs: "h-7 px-2.5 text-xs rounded-md",
        sm: "h-8 px-3 text-xs rounded-md",
        default: "h-9 px-4 text-sm rounded-md",
        lg: "h-10 px-6 text-sm rounded-md",
        icon: "h-9 w-9 rounded-md",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { buttonVariants };
