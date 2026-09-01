import { unlink } from "node:fs/promises";
import path from "node:path";

import { IngestError, ingestPdf } from "@/lib/rag/ingest";
import { FILES_DIR, listDocuments, removeDocument } from "@/lib/rag/store";

// Uploads go through a Route Handler rather than a Server Action because
// Server Action request bodies are capped at 1MB by default.
export const runtime = "nodejs";
export const maxDuration = 60;

export type UploadResult =
  | { filename: string; ok: true; docId: string; pages: number; chunks: number }
  | { filename: string; ok: false; error: string };

function message(err: unknown) {
  if (err instanceof IngestError) return err.message;
  if (err instanceof Error) return err.message;
  return "Upload failed";
}

export async function GET() {
  try {
    return Response.json({ documents: await listDocuments() });
  } catch (err) {
    return Response.json({ error: message(err) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Expected multipart form data" }, { status: 400 });
  }

  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return Response.json({ error: "No files provided" }, { status: 400 });
  }

  // Sequential, not Promise.all: embedding calls are rate-limited on the free
  // tier, and one bad file shouldn't take down the whole batch.
  const results: UploadResult[] = [];
  for (const file of files) {
    try {
      const record = await ingestPdf(file);
      results.push({
        filename: record.filename,
        ok: true,
        docId: record.docId,
        pages: record.pages,
        chunks: record.chunks,
      });
    } catch (err) {
      results.push({ filename: file.name, ok: false, error: message(err) });
    }
  }

  return Response.json({ results, documents: await listDocuments() });
}

export async function DELETE(request: Request) {
  const docId = new URL(request.url).searchParams.get("docId");
  if (!docId) return Response.json({ error: "docId is required" }, { status: 400 });

  try {
    const removed = await removeDocument(docId);
    if (!removed) return Response.json({ error: "Document not found" }, { status: 404 });

    // docId is a server-generated UUID, but basename it anyway before touching disk.
    await unlink(path.join(FILES_DIR, `${path.basename(docId)}.pdf`)).catch(() => undefined);
    return Response.json({ documents: await listDocuments() });
  } catch (err) {
    return Response.json({ error: message(err) }, { status: 500 });
  }
}
