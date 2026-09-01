"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  FileTextIcon,
  FolderOpenIcon,
  PlusIcon,
  TriangleAlertIcon,
} from "lucide-react";

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { askDocuments, type ChatMessage, type Source } from "@/lib/actions/doc-chat";

export default function DocChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [threadId, setThreadId] = useState(() => crypto.randomUUID());
  const [input, setInput] = useState("");
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [docCount, setDocCount] = useState<number | null>(null);
  const stopped = useRef(false);

  const isEmpty = messages.length === 0;
  const busy = streamingId !== null;

  useEffect(() => {
    fetch("/api/documents")
      .then((r) => r.json())
      .then((d) => setDocCount(Array.isArray(d.documents) ? d.documents.length : 0))
      .catch(() => setDocCount(0));
  }, []);

  async function send(prompt: string) {
    if (!prompt || busy) return;

    const replyId = crypto.randomUUID();

    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "user", content: prompt },
      { id: replyId, role: "ai", content: "" },
    ]);
    setInput("");
    setStreamingId(replyId);
    stopped.current = false;

    const patch = (fn: (m: ChatMessage) => ChatMessage) =>
      setMessages((prev) => prev.map((m) => (m.id === replyId ? fn(m) : m)));

    try {
      const stream = await askDocuments(prompt, threadId);

      for await (const chunk of stream) {
        if (stopped.current) break;

        if (chunk.type === "error") {
          patch((m) => ({ ...m, role: "error", content: chunk.error }));
          break;
        }

        if (chunk.type === "sources") {
          patch((m) => ({ ...m, sources: chunk.sources }));
          continue;
        }

        patch((m) => ({ ...m, content: m.content + chunk.text }));
      }
    } catch (err) {
      patch((m) => ({
        ...m,
        role: "error",
        content: err instanceof Error ? err.message : "Something went wrong",
      }));
    } finally {
      setMessages((prev) => prev.filter((m) => m.id !== replyId || m.content !== ""));
      setStreamingId(null);
      stopped.current = false;
    }
  }

  return (
    <div className="flex h-dvh flex-col">
      <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-2">
          <FileTextIcon className="size-4 text-muted-foreground" />
          <h1 className="text-sm font-medium">Chat with your documents</h1>
          {docCount !== null && (
            <span className="text-xs text-muted-foreground">{docCount} indexed</span>
          )}
          <Link
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "ml-auto")}
            href="/documents"
          >
            <FolderOpenIcon />
            Documents
          </Link>
          <Button
            disabled={isEmpty}
            onClick={() => {
              setMessages([]);
              setThreadId(crypto.randomUUID());
            }}
            size="sm"
            variant="ghost"
          >
            <PlusIcon />
            New chat
          </Button>
        </div>
      </header>

      <Conversation className="min-h-0 flex-1">
        <ConversationContent
          className={cn("mx-auto w-full max-w-3xl gap-6 px-4 py-6", isEmpty && "h-full")}
        >
          {isEmpty && (
            <ConversationEmptyState
              className="m-auto size-auto"
              description={
                docCount === 0
                  ? "Upload a PDF first, then ask questions about it."
                  : "Ask anything about your uploaded PDFs."
              }
              icon={<FileTextIcon className="size-8" />}
              title={docCount === 0 ? "No documents yet" : "What do your documents say?"}
            />
          )}

          {messages.map((m) => {
            if (m.role === "error") {
              return (
                <Message from="assistant" key={m.id}>
                  <MessageContent className="w-full max-w-full flex-row items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-destructive">
                    <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
                    <span className="min-w-0 wrap-anywhere">{m.content}</span>
                  </MessageContent>
                </Message>
              );
            }

            if (m.role === "user") {
              return (
                <Message from="user" key={m.id}>
                  <MessageContent className="max-w-[85%] sm:max-w-[75%]">
                    <span className="whitespace-pre-wrap wrap-anywhere">{m.content}</span>
                  </MessageContent>
                </Message>
              );
            }

            return (
              <Message from="assistant" key={m.id}>
                <MessageContent className="max-w-[85%] flex-col items-start gap-2 sm:max-w-[75%]">
                  {m.content ? (
                    <MessageResponse isAnimating={m.id === streamingId}>
                      {m.content}
                    </MessageResponse>
                  ) : (
                    <ThinkingDots />
                  )}
                  {m.sources && m.sources.length > 0 && <Sources sources={m.sources} />}
                </MessageContent>
              </Message>
            );
          })}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="shrink-0 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <div className="mx-auto w-full max-w-3xl space-y-3">
          <PromptInput
            onSubmit={(e) => {
              e.preventDefault();
              // While streaming the same button acts as stop.
              if (busy) {
                stopped.current = true;
                return;
              }
              send(input.trim());
            }}
          >
            <PromptInputTextarea
              autoFocus
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about your documents..."
              value={input}
            />
            <PromptInputToolbar>
              <PromptInputTools>
                <span className="px-2 text-xs">
                  <kbd className="font-sans font-medium">Enter</kbd> to send ·{" "}
                  <kbd className="font-sans font-medium">Shift+Enter</kbd> for a new line
                </span>
              </PromptInputTools>
              <PromptInputSubmit
                disabled={!busy && !input.trim()}
                status={busy ? "streaming" : "ready"}
              />
            </PromptInputToolbar>
          </PromptInput>
        </div>
      </div>
    </div>
  );
}

function Sources({ sources }: { sources: Source[] }) {
  return (
    <div className="flex w-full flex-wrap gap-1.5 border-t pt-2">
      <span className="w-full text-xs font-medium text-muted-foreground">Sources</span>
      {sources.map((s) => (
        <span
          key={`${s.filename}#${s.page}`}
          title={s.snippet}
          className="inline-flex items-center gap-1 rounded-md border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground"
        >
          <FileTextIcon className="size-3" />
          {s.filename}
          <span className="opacity-70">p.{s.page}</span>
        </span>
      ))}
    </div>
  );
}

function ThinkingDots() {
  return (
    <span className="flex items-center gap-1 py-1" role="status">
      <span className="sr-only">Thinking</span>
      {["0ms", "150ms", "300ms"].map((delay) => (
        <span
          className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60"
          key={delay}
          style={{ animationDelay: delay }}
        />
      ))}
    </span>
  );
}
