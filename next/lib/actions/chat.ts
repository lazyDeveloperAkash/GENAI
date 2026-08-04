"use server";

import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";

export type ChatRole = "user" | "ai" | "error";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
};

/**
 * One piece of a streamed reply. Errors are yielded rather than thrown: a throw
 * inside the generator reaches the client as an opaque digest in production,
 * whereas this keeps the real message.
 */
export type ChatChunk =
  | { type: "delta"; text: string }
  | { type: "error"; error: string };

const llm = new ChatGoogleGenerativeAI({
  model: "gemini-3.6-flash",
  apiKey: process.env.GOOGLE_API_KEY,
  streaming: true,
});

function toText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === "string" ? part : (part as { text?: string })?.text ?? ""
      )
      .join("");
  }
  return "";
}

function toLangChain(history: ChatMessage[]): BaseMessage[] {
  return history
    .filter((m) => m.role !== "error" && m.content.trim() !== "")
    .map((m) =>
      m.role === "user" ? new HumanMessage(m.content) : new AIMessage(m.content)
    );
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong";
}

/**
 * Streams a reply token-by-token.
 *
 * React serializes the returned async iterable over the RSC wire, so the client
 * can `for await` it straight off the action. The LangChain stream itself can't
 * be returned as-is — it yields AIMessageChunk class instances, which aren't
 * serializable — so each chunk is flattened to a plain object here.
 */
export async function streamGemini(history: ChatMessage[], prompt: string) {
  const messages = [...toLangChain(history), new HumanMessage(prompt)];

  async function* generate(): AsyncGenerator<ChatChunk> {
    try {
      const stream = await llm.stream(messages);
      for await (const chunk of stream) {
        const text = toText(chunk.content);
        if (text) yield { type: "delta", text };
      }
    } catch (err) {
      yield { type: "error", error: toMessage(err) };
    }
  }

  return generate();
}
