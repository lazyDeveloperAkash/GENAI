"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArrowUpIcon, LoaderCircleIcon, SquareIcon, XIcon } from "lucide-react";
import type { ComponentProps, KeyboardEvent } from "react";
import { useCallback, useEffect, useRef } from "react";

export type PromptInputStatus = "ready" | "submitted" | "streaming" | "error";

export type PromptInputProps = ComponentProps<"form">;

export const PromptInput = ({ className, ...props }: PromptInputProps) => (
  <form
    className={cn(
      "w-full overflow-hidden rounded-2xl border border-input bg-background shadow-xs transition-[color,box-shadow]",
      "focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
      "dark:bg-input/30",
      className
    )}
    {...props}
  />
);

export type PromptInputTextareaProps = ComponentProps<"textarea"> & {
  /** Rows to show before the field starts growing. */
  minRows?: number;
  /** Rows to grow to before the field starts scrolling. */
  maxRows?: number;
};

export const PromptInputTextarea = ({
  className,
  minRows = 1,
  maxRows = 8,
  onKeyDown,
  value,
  ...props
}: PromptInputTextareaProps) => {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Grow with the content up to maxRows, then scroll. Measured off lineHeight so
  // it stays correct if the font or text size changes.
  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;

    const styles = getComputedStyle(el);
    const lineHeight = Number.parseFloat(styles.lineHeight) || 20;
    const vertical =
      Number.parseFloat(styles.paddingTop) +
      Number.parseFloat(styles.paddingBottom);

    el.style.height = "auto";
    el.style.height = `${Math.min(
      Math.max(el.scrollHeight, lineHeight * minRows + vertical),
      lineHeight * maxRows + vertical
    )}px`;
  }, [minRows, maxRows]);

  useEffect(resize, [resize, value]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    onKeyDown?.(e);
    if (e.defaultPrevented) return;

    // Enter sends, Shift+Enter adds a newline. Ignore IME composition so
    // CJK candidate selection doesn't fire off a half-typed message.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      e.currentTarget.form?.requestSubmit();
    }
  };

  return (
    <textarea
      ref={ref}
      rows={minRows}
      value={value}
      onKeyDown={handleKeyDown}
      className={cn(
        "w-full resize-none bg-transparent px-4 py-3.5 text-base outline-none",
        "placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className
      )}
      {...props}
    />
  );
};

export type PromptInputToolbarProps = ComponentProps<"div">;

export const PromptInputToolbar = ({
  className,
  ...props
}: PromptInputToolbarProps) => (
  <div
    className={cn("flex items-center justify-between gap-2 p-2 pt-0", className)}
    {...props}
  />
);

export type PromptInputToolsProps = ComponentProps<"div">;

export const PromptInputTools = ({
  className,
  ...props
}: PromptInputToolsProps) => (
  <div
    className={cn("flex items-center gap-1 text-muted-foreground", className)}
    {...props}
  />
);

export type PromptInputSubmitProps = ComponentProps<typeof Button> & {
  status?: PromptInputStatus;
};

export const PromptInputSubmit = ({
  className,
  variant = "default",
  size = "icon",
  status = "ready",
  children,
  ...props
}: PromptInputSubmitProps) => {
  const icon = {
    ready: <ArrowUpIcon className="size-4" />,
    submitted: <LoaderCircleIcon className="size-4 animate-spin" />,
    streaming: <SquareIcon className="size-4" />,
    error: <XIcon className="size-4" />,
  }[status];

  return (
    <Button
      className={cn("rounded-full", className)}
      size={size}
      type="submit"
      variant={variant}
      {...props}
    >
      {children ?? icon}
      <span className="sr-only">Send message</span>
    </Button>
  );
};
