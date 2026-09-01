import "server-only";

import { randomUUID } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { Document } from "@langchain/core/documents";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

import { addDocument, ChunkMetadata, DocumentRecord, FILES_DIR } from "./store";

export const MAX_FILE_BYTES = 20 * 1024 * 1024;

const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 1000,
  chunkOverlap: 200,
});

export class IngestError extends Error {}

/**
 * Verifies the real file signature rather than trusting the browser-supplied
 * MIME type, which is attacker-controlled.
 */
function assertPdf(bytes: Uint8Array, filename: string) {
  const header = new TextDecoder().decode(bytes.subarray(0, 5));
  if (!header.startsWith("%PDF-")) {
    throw new IngestError(`${filename} is not a valid PDF`);
  }
}

/** Strips any directory component so a crafted name can't escape FILES_DIR. */
function safeName(filename: string) {
  return path.basename(filename).replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "document.pdf";
}

async function extractPages(bytes: Uint8Array): Promise<{ num: number; text: string }[]> {
  // Imported lazily: pdf-parse is heavy and only needed on an actual upload.
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: bytes });
  try {
    const result = await parser.getText();
    return result.pages.map((p) => ({ num: p.num, text: p.text }));
  } finally {
    await parser.destroy();
  }
}

/**
 * Saves the original file, splits its text into chunks, embeds them and adds
 * them to the index. Chunks carry the page number so answers can cite sources.
 */
export async function ingestPdf(file: File): Promise<DocumentRecord> {
  const filename = safeName(file.name);

  if (file.size === 0) throw new IngestError(`${filename} is empty`);
  if (file.size > MAX_FILE_BYTES) {
    throw new IngestError(`${filename} exceeds the ${MAX_FILE_BYTES / 1024 / 1024}MB limit`);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  assertPdf(bytes, filename);

  const docId = randomUUID();
  const storedPath = path.join(FILES_DIR, `${docId}.pdf`);
  await writeFile(storedPath, bytes);

  try {
    const pages = await extractPages(bytes);

    const chunks: Document<ChunkMetadata>[] = [];
    for (const page of pages) {
      const text = page.text.trim();
      if (!text) continue; // scanned/image-only page

      for (const piece of await splitter.splitText(text)) {
        chunks.push(
          new Document({
            pageContent: piece,
            metadata: { docId, filename, page: page.num },
          }),
        );
      }
    }

    if (chunks.length === 0) {
      throw new IngestError(
        `No selectable text found in ${filename}. Scanned PDFs need OCR before they can be indexed.`,
      );
    }

    const record: DocumentRecord = {
      docId,
      filename,
      bytes: file.size,
      pages: pages.length,
      chunks: chunks.length,
      uploadedAt: new Date().toISOString(),
    };

    await addDocument(record, chunks);
    return record;
  } catch (err) {
    // Don't leave an orphaned file behind for a document that never got indexed.
    await unlink(storedPath).catch(() => undefined);
    throw err;
  }
}
