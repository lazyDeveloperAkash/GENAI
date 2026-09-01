import "server-only";

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { Document } from "@langchain/core/documents";
import { MemoryVectorStore } from "@langchain/classic/vectorstores/memory";

export const STORAGE_DIR = path.join(process.cwd(), "storage");
export const FILES_DIR = path.join(STORAGE_DIR, "files");
const INDEX_DIR = path.join(STORAGE_DIR, "index");
const VECTORS_FILE = path.join(INDEX_DIR, "vectors.json");
const MANIFEST_FILE = path.join(INDEX_DIR, "manifest.json");

export type ChunkMetadata = {
  docId: string;
  filename: string;
  page: number;
};

export type DocumentRecord = {
  docId: string;
  filename: string;
  bytes: number;
  pages: number;
  chunks: number;
  uploadedAt: string;
};

/** One embedded chunk, exactly as it is persisted to disk. */
type StoredVector = {
  content: string;
  embedding: number[];
  metadata: ChunkMetadata;
};

/**
 * MemoryVectorStore keeps everything in RAM, so `vectors.json` — not the store —
 * is the source of truth. The store is a cache we rebuild from it on boot, which
 * also means restarts cost no embedding API calls.
 */
type Cache = {
  store: MemoryVectorStore;
  manifest: DocumentRecord[];
  /** Serializes read-modify-write cycles so concurrent uploads can't clobber each other. */
  queue: Promise<unknown>;
};

// Next re-executes modules on hot reload; a module-level variable would reset the
// index on every save. globalThis outlives that.
const globalCache = globalThis as unknown as { __ragCache?: Promise<Cache> };

// text-embedding-004 and embedding-001 both 404 on the current Gemini API.
// gemini-embedding-001 is the live model (3072 dimensions).
export const EMBEDDING_MODEL = "gemini-embedding-001";

function embeddings() {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_API_KEY is not set");
  return new GoogleGenerativeAIEmbeddings({ apiKey, model: EMBEDDING_MODEL });
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw err;
  }
}

/** Write to a temp file then rename, so a crash mid-write can't truncate the index. */
async function writeJsonAtomic(file: string, data: unknown) {
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(data), "utf8");
  await rename(tmp, file);
}

async function build(): Promise<Cache> {
  await mkdir(FILES_DIR, { recursive: true });
  await mkdir(INDEX_DIR, { recursive: true });

  const [vectors, manifest] = await Promise.all([
    readJson<StoredVector[]>(VECTORS_FILE, []),
    readJson<DocumentRecord[]>(MANIFEST_FILE, []),
  ]);

  const store = new MemoryVectorStore(embeddings());

  if (vectors.length > 0) {
    // addVectors skips re-embedding — the vectors were already paid for.
    await store.addVectors(
      vectors.map((v) => v.embedding),
      vectors.map((v) => new Document({ pageContent: v.content, metadata: v.metadata })),
    );
  }

  return { store, manifest, queue: Promise.resolve() };
}

function cache(): Promise<Cache> {
  globalCache.__ragCache ??= build();
  return globalCache.__ragCache;
}

/** Runs `fn` with exclusive access to the index, then persists whatever it changed. */
async function withLock<T>(fn: (c: Cache) => Promise<T>): Promise<T> {
  const c = await cache();
  const run = c.queue.then(() => fn(c));
  // Swallow here so one failed upload doesn't poison the queue for the next.
  c.queue = run.catch(() => undefined);
  return run;
}

function snapshot(c: Cache): StoredVector[] {
  return c.store.memoryVectors.map((v) => ({
    content: v.content,
    embedding: v.embedding,
    metadata: v.metadata as ChunkMetadata,
  }));
}

async function persist(c: Cache) {
  await Promise.all([
    writeJsonAtomic(VECTORS_FILE, snapshot(c)),
    writeJsonAtomic(MANIFEST_FILE, c.manifest),
  ]);
}

export async function listDocuments(): Promise<DocumentRecord[]> {
  const c = await cache();
  return [...c.manifest].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}

export async function addDocument(record: DocumentRecord, chunks: Document<ChunkMetadata>[]) {
  return withLock(async (c) => {
    const before = c.store.memoryVectors.length;
    await c.store.addDocuments(chunks);
    const added = c.store.memoryVectors.slice(before);

    // A wrong/deprecated embedding model can return empty vectors without
    // throwing, which would silently index documents that can never be
    // retrieved. Refuse to persist that.
    if (added.length === 0 || added.some((v) => !v.embedding || v.embedding.length === 0)) {
      c.store.memoryVectors.length = before;
      throw new Error(
        `Embedding failed: model "${EMBEDDING_MODEL}" returned no vector data. Check GOOGLE_API_KEY and the model name.`,
      );
    }

    c.manifest.push(record);
    await persist(c);
  });
}

export async function removeDocument(docId: string): Promise<boolean> {
  return withLock(async (c) => {
    const before = c.manifest.length;
    c.manifest = c.manifest.filter((d) => d.docId !== docId);
    if (c.manifest.length === before) return false;

    // MemoryVectorStore has no delete(); filter its backing array directly.
    c.store.memoryVectors = c.store.memoryVectors.filter(
      (v) => (v.metadata as ChunkMetadata).docId !== docId,
    );
    await persist(c);
    return true;
  });
}

export async function search(query: string, k = 5) {
  const c = await cache();
  if (c.store.memoryVectors.length === 0) return [];
  return c.store.similaritySearchWithScore(query, k);
}

export async function isEmpty(): Promise<boolean> {
  const c = await cache();
  return c.store.memoryVectors.length === 0;
}
