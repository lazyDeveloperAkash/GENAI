"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  FileTextIcon,
  Loader2Icon,
  MessageSquareIcon,
  TrashIcon,
  TriangleAlertIcon,
  UploadIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { DocumentRecord } from "@/lib/rag/store";
import type { UploadResult } from "@/app/api/documents/route";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [results, setResults] = useState<UploadResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/documents")
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to load documents");
        return data.documents as DocumentRecord[];
      })
      .then((docs) => {
        if (!cancelled) setDocuments(docs);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load documents");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function upload(files: FileList | File[]) {
    const list = Array.from(files).filter((f) => f.name.toLowerCase().endsWith(".pdf"));
    if (list.length === 0) {
      setError("Only PDF files are supported right now.");
      return;
    }

    setUploading(true);
    setError(null);
    setResults([]);

    try {
      const form = new FormData();
      for (const file of list) form.append("files", file);

      const res = await fetch("/api/documents", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");

      setResults(data.results);
      setDocuments(data.documents);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove(docId: string) {
    try {
      const res = await fetch(`/api/documents?docId=${encodeURIComponent(docId)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Delete failed");
      setDocuments(data.documents);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  const totalChunks = documents.reduce((sum, d) => sum + d.chunks, 0);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 px-6 py-10">
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
          <p className="text-sm text-muted-foreground">
            Upload PDFs to index them. {documents.length} document
            {documents.length === 1 ? "" : "s"}, {totalChunks} chunk
            {totalChunks === 1 ? "" : "s"}.
          </p>
        </div>
        <Link
          className={buttonVariants({ variant: "outline" })}
          href="/doc-chat"
        >
          <MessageSquareIcon />
          Chat
        </Link>
      </header>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!uploading) void upload(e.dataTransfer.files);
        }}
        onClick={() => !uploading && inputRef.current?.click()}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors",
          dragging ? "border-primary bg-primary/5" : "border-muted-foreground/25",
          uploading && "pointer-events-none opacity-60",
        )}
      >
        {uploading ? (
          <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
        ) : (
          <UploadIcon className="size-6 text-muted-foreground" />
        )}
        <p className="text-sm font-medium">
          {uploading ? "Indexing…" : "Drop PDFs here, or click to browse"}
        </p>
        <p className="text-xs text-muted-foreground">
          Text-based PDFs only, up to 20MB each
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          multiple
          hidden
          onChange={(e) => e.target.files && void upload(e.target.files)}
        />
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <TriangleAlertIcon className="size-4 shrink-0" />
          {error}
        </div>
      )}

      {results.length > 0 && (
        <div className="space-y-1.5">
          {results.map((r) => (
            <div
              key={r.filename + (r.ok ? r.docId : r.error)}
              className={cn(
                "flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm",
                r.ok
                  ? "border-muted bg-muted/30"
                  : "border-destructive/40 bg-destructive/5 text-destructive",
              )}
            >
              <span className="truncate font-medium">{r.filename}</span>
              <span className="shrink-0 text-xs">
                {r.ok ? `${r.pages} pages · ${r.chunks} chunks` : r.error}
              </span>
            </div>
          ))}
        </div>
      )}

      <section className="space-y-2">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : documents.length === 0 ? (
          <p className="text-sm text-muted-foreground">No documents indexed yet.</p>
        ) : (
          documents.map((doc) => (
            <Card
              key={doc.docId}
              className="flex flex-row items-center gap-3 px-4 py-3"
            >
              <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{doc.filename}</p>
                <p className="text-xs text-muted-foreground">
                  {formatBytes(doc.bytes)} · {doc.pages} pages ·{" "}
                  {new Date(doc.uploadedAt).toLocaleString()}
                </p>
              </div>
              <Badge variant="secondary" className="shrink-0">
                {doc.chunks} chunks
              </Badge>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Delete ${doc.filename}`}
                onClick={() => void remove(doc.docId)}
              >
                <TrashIcon />
              </Button>
            </Card>
          ))
        )}
      </section>
    </main>
  );
}
