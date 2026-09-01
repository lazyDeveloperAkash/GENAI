import Link from "next/link";
import { ArrowRightIcon, SparklesIcon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="inline-flex items-center gap-2 rounded-full border bg-muted/50 px-3 py-1 text-xs text-muted-foreground">
        <SparklesIcon className="size-3.5" />
        Powered by Gemini 3.6 Flash
      </div>

      <div className="space-y-3">
        <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
          A minimal AI chat
        </h1>
        <p className="mx-auto max-w-md text-balance text-muted-foreground">
          Built with Next.js, LangChain, and shadcn/ui. Start a conversation and
          see where it goes.
        </p>
      </div>

      <Link
        className={buttonVariants({ size: "lg", className: "px-4" })}
        href="/chat"
      >
        Start chatting
        <ArrowRightIcon />
      </Link>
      <Link
        className={buttonVariants({ size: "lg", className: "px-4" })}
        href="/chat-google"
      >
        Chat with Google
        <ArrowRightIcon />
      </Link>
      <Link
        className={buttonVariants({ size: "lg", className: "px-4" })}
        href="/chat-bot"
      >
        Chat Bot
        <ArrowRightIcon />
      </Link>
      <Link
        className={buttonVariants({ size: "lg", className: "px-4" })}
        href="/doc-chat"
      >
        Chat with your PDFs
        <ArrowRightIcon />
      </Link>
    </main>
  );
}
