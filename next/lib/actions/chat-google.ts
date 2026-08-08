"use server";

import { ChatGroq } from "@langchain/groq";
import { MemorySaver } from "@langchain/langgraph";
import { createAgent, tool } from "langchain";
import { z } from "zod";

export type ChatRole = "user" | "ai" | "error";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
};

export type StreamChunk =
  | { type: "delta"; text: string }
  | { type: "error"; error: string };

const llm = new ChatGroq({
  model: "openai/gpt-oss-120b",
  apiKey: process.env.GROQ_API_KEY || "",
  streaming: true,
});

const searchGoogle = tool(
  async ({ query }: { query: string }) => {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": process.env.SERPER_API_KEY || "",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: query }),
    });

    if (!res.ok) {
      throw new Error(`Search request failed with status ${res.status}`);
    }

    const data = (await res.json()) as {
      answerBox?: unknown;
      organic?: Array<{ title?: string; link?: string; snippet?: string }>;
    };

    const organic = data.organic?.slice(0, 5).map((r) => ({
      title: r.title ?? "",
      link: r.link ?? "",
      snippet: r.snippet ?? "",
    }));

    return JSON.stringify({ answerBox: data.answerBox ?? null, organic });
  },
  {
    name: "google_serper",
    description:
      "A Google Search API. Useful for answering questions about current events. Input should be a search query",
    schema: z.object({
      query: z.string().describe("The search query"),
    }),
  },
);

const agent = createAgent({
  model: llm,
  tools: [searchGoogle],
  systemPrompt: "You are an agent and you can search anything on google",
  checkpointer: new MemorySaver(),
});

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong";
}

// This is an async GENERATOR ("async function*"), not a plain async
// function — that's what lets the client do `for await (const chunk of stream)`.
export async function* callLLM(
  prompt: string,
  id: string,
): AsyncGenerator<StreamChunk> {
  if (!process.env.GROQ_API_KEY) {
    yield { type: "error", error: "GROQ_API_KEY is not configured" };
    return;
  }

  const threadConfig = { configurable: { thread_id: id } };

  try {
    // streamMode: "messages" gives you token-level LLM chunks
    // (as [messageChunk, metadata] tuples) instead of full-state
    // snapshots after every graph step.
    const stream = await agent.stream(
      { messages: [{ role: "user", content: prompt }] },
      { ...threadConfig, streamMode: "messages" },
    );

    for await (const [chunk, metadata] of stream) {
      // Message chunks expose their role via getType()/_getType.
      // We only want AI-generated tokens, not tool call/result chunks.
      const messageType =
        typeof chunk?.getType === "function" ? chunk.getType() : chunk?._getType;

      if (messageType && messageType !== "ai") continue;

      const text = typeof chunk?.content === "string" ? chunk.content : "";
      if (text) {
        yield { type: "delta", text };
      }
    }
  } catch (err) {
    yield { type: "error", error: toMessage(err) };
  }
}