"use client";

import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex min-h-10 shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md px-4 py-2 text-[13px] font-semibold tracking-[-0.005em] transition-colors disabled:cursor-not-allowed disabled:border-line disabled:bg-raised disabled:text-disabled",
  {
    variants: {
      variant: {
        primary: "border border-accent bg-accent text-canvas shadow-[0_0_24px_-6px_rgba(46,230,184,0.65)] hover:not-disabled:border-accent-hover hover:not-disabled:bg-accent-hover hover:not-disabled:shadow-[0_0_28px_-4px_rgba(46,230,184,0.8)]",
        secondary: "border border-line-strong bg-surface text-ink hover:not-disabled:border-faint hover:not-disabled:bg-hover",
      },
    },
    defaultVariants: {
      variant: "primary",
    },
  },
);

function Button({
  className,
  variant,
  asChild = false,
  ...props
}: ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Component = asChild ? Slot : "button";
  return <Component data-slot="button" className={cn(buttonVariants({ variant }), className)} {...props} />;
}

export { Button, buttonVariants };
