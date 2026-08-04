"use client";

import { useRef, useState } from "react";
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
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MessageSquareIcon, PlusIcon, TriangleAlertIcon } from "lucide-react";
import { streamGemini, type ChatMessage } from "@/lib/actions/chat";

const SUGGESTIONS = [
  "Explain the event loop in Node.js",
  "Write a regex for validating emails",
  "Summarize the SOLID principles",
];

export default function Page() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  // Id of the reply currently being streamed, or null when idle.
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const stopped = useRef(false);

  const busy = streamingId !== null;
  const isEmpty = messages.length === 0;

  async function send(prompt: string) {
    if (!prompt || busy) return;

    const history = messages;
    const replyId = crypto.randomUUID();

    // Append the user turn plus an empty assistant turn that tokens stream into.
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
      const stream = await streamGemini(history, prompt);

      for await (const chunk of stream) {
        if (stopped.current) break;

        if (chunk.type === "error") {
          patch((m) => ({ ...m, role: "error", content: chunk.error }));
          break;
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
      // Nothing ever arrived (stopped immediately, or an empty reply) — drop the
      // placeholder rather than leaving a blank bubble behind.
      setMessages((prev) =>
        prev.filter((m) => m.id !== replyId || m.content !== "")
      );
      setStreamingId(null);
    }
  }

  return (
    <div className="flex h-dvh flex-col">
      <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-2">
          <MessageSquareIcon className="size-4 text-muted-foreground" />
          <h1 className="text-sm font-medium">Chat</h1>
          <Button
            className="ml-auto"
            disabled={isEmpty || busy}
            onClick={() => setMessages([])}
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
          className={cn(
            "mx-auto w-full max-w-3xl gap-6 px-4 py-6",
            // A full-height content box is what lets the empty state center vertically.
            isEmpty && "h-full"
          )}
        >
          {isEmpty && (
            <ConversationEmptyState
              className="m-auto size-auto"
              description="Ask anything to get started."
              icon={<MessageSquareIcon className="size-8" />}
              title="How can I help?"
            />
          )}

          {messages.map((m) => {
            if (m.role === "error") {
              return (
                <Message from="assistant" key={m.id}>
                  <MessageContent className="w-full max-w-full flex-row items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-destructive">
                    <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
                    <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                      {m.content}
                    </span>
                  </MessageContent>
                </Message>
              );
            }

            if (m.role === "user") {
              return (
                <Message from="user" key={m.id}>
                  <MessageContent className="max-w-[85%] sm:max-w-[75%]">
                    <span className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                      {m.content}
                    </span>
                  </MessageContent>
                </Message>
              );
            }

            return (
              <Message from="assistant" key={m.id}>
                <MessageContent className="max-w-[85%] sm:max-w-[75%]">
                  {m.content ? (
                    <MessageResponse isAnimating={m.id === streamingId}>
                      {m.content}
                    </MessageResponse>
                  ) : (
                    <ThinkingDots />
                  )}
                </MessageContent>
              </Message>
            );
          })}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="shrink-0 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <div className="mx-auto w-full max-w-3xl space-y-3">
          {isEmpty && !busy && (
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <Button
                  key={s}
                  onClick={() => send(s)}
                  size="sm"
                  variant="outline"
                >
                  {s}
                </Button>
              ))}
            </div>
          )}

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
              placeholder="Ask something..."
              value={input}
            />
            <PromptInputToolbar>
              <PromptInputTools>
                <span className="px-2 text-xs">
                  <kbd className="font-sans font-medium">Enter</kbd> to send ·{" "}
                  <kbd className="font-sans font-medium">Shift+Enter</kbd> for a
                  new line
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
