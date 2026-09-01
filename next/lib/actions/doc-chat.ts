"use server";

import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { MemorySaver } from "@langchain/langgraph";
import { createAgent, tool } from "langchain";
import { z } from "zod";

import { isEmpty, search, type ChunkMetadata } from "@/lib/rag/store";

export type ChatRole = "user" | "ai" | "error";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  sources?: Source[];
};

export type Source = {
  filename: string;
  page: number;
  snippet: string;
};

export type StreamChunk =
  | { type: "delta"; text: string }
  | { type: "sources"; sources: Source[] }
  | { type: "error"; error: string };

const SYSTEM_PROMPT = `You answer questions about the user's uploaded PDF documents.

Always call search_documents before answering anything that concerns the documents.
If the first search is unhelpful, search again with different wording before giving up.
Ground every claim in the retrieved excerpts and cite them inline as (filename, p.N).
If the excerpts do not contain the answer, say so plainly instead of guessing.`;

// One checkpointer for the whole module so a thread_id keeps its history across
// requests. The agent itself is rebuilt per request because its tool closes over
// that request's own sources array — a module-level array would interleave
// between concurrent users.
const checkpointer = new MemorySaver();

function makeSearchTool(collected: Source[]) {
  return tool(
    async ({ query }: { query: string }) => {
      const hits = await search(query, 5);

      if (hits.length === 0) {
        return "No documents have been indexed yet, or nothing matched. Tell the user to upload a PDF first.";
      }

      const blocks = hits.map(([doc, score], i) => {
        const meta = doc.metadata as ChunkMetadata;
        collected.push({
          filename: meta.filename,
          page: meta.page,
          snippet: doc.pageContent.slice(0, 240),
        });
        return `[${i + 1}] ${meta.filename} (p.${meta.page}, relevance ${score.toFixed(3)})\n${doc.pageContent}`;
      });

      return blocks.join("\n\n---\n\n");
    },
    {
      name: "search_documents",
      description:
        "Semantic search over the user's uploaded PDFs. Input a natural-language description of the information you need, not keywords.",
      schema: z.object({
        query: z.string().describe("What to look for in the documents"),
      }),
    },
  );
}

function makeAgent(collected: Source[]) {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_API_KEY is not set");

  const llm = new ChatGoogleGenerativeAI({
    model: "gemini-3.6-flash",
    apiKey,
    streaming: true,
  });

  return createAgent({
    model: llm,
    tools: [makeSearchTool(collected)],
    systemPrompt: SYSTEM_PROMPT,
    checkpointer,
  });
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong";
}

/** Dedupes to one entry per (file, page) so the UI doesn't repeat the same page. */
function dedupe(sources: Source[]): Source[] {
  const seen = new Map<string, Source>();
  for (const s of sources) {
    const key = `${s.filename}#${s.page}`;
    if (!seen.has(key)) seen.set(key, s);
  }
  return [...seen.values()];
}

export async function* askDocuments(
  prompt: string,
  threadId: string,
): AsyncGenerator<StreamChunk> {
  if (!process.env.GOOGLE_API_KEY) {
    yield { type: "error", error: "GOOGLE_API_KEY is not configured" };
    return;
  }

  if (await isEmpty()) {
    yield { type: "error", error: "No documents indexed yet — upload a PDF first." };
    return;
  }

  const turnSources: Source[] = [];

  try {
    const stream = await makeAgent(turnSources).stream(
      { messages: [{ role: "user", content: prompt }] },
      { configurable: { thread_id: threadId }, streamMode: "messages" },
    );

    for await (const [chunk] of stream) {
      const messageType =
        typeof chunk?.getType === "function" ? chunk.getType() : chunk?._getType;

      // Skip tool-call and tool-result chunks; only stream the model's prose.
      if (messageType && messageType !== "ai") continue;

      const text = typeof chunk?.content === "string" ? chunk.content : "";
      if (text) yield { type: "delta", text };
    }

    if (turnSources.length > 0) {
      yield { type: "sources", sources: dedupe(turnSources) };
    }
  } catch (err) {
    yield { type: "error", error: toMessage(err) };
  }
}
