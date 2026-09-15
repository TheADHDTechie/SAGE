import fs from "node:fs";
import { z } from "zod";
import type { Citation } from "../domain/types.js";

const manualChunkSchema = z.object({
  id: z.string().min(1),
  document_id: z.string().min(1),
  source_title: z.string().min(1),
  source_organization: z.string().min(1),
  source_file: z.string().min(1),
  title: z.string().min(1),
  chapter: z.string().min(1),
  section: z.string().min(1),
  topic: z.string().min(1),
  tags: z.array(z.string()),
  content_type: z.string().min(1),
  language: z.string().min(1),
  page_start: z.number().int().positive(),
  page_end: z.number().int().positive(),
  chunk_part: z.number().int().positive(),
  chunk_part_count: z.number().int().positive(),
  word_count: z.number().int().positive(),
  char_count: z.number().int().positive(),
  extraction_method: z.string().min(1),
  text: z.string().min(1),
});

export type ManualChunk = z.infer<typeof manualChunkSchema>;

export class ManualRepository {
  readonly chunks: readonly ManualChunk[];
  readonly context: string;
  readonly version: string;
  private readonly chunksById: ReadonlyMap<string, ManualChunk>;

  constructor(filePath: string) {
    const lines = fs
      .readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0);

    const chunks = lines.map((line, index) => {
      let raw: unknown;
      try {
        raw = JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid JSON at manual line ${index + 1}`, { cause: error });
      }

      const chunk = manualChunkSchema.parse(raw);
      if (chunk.page_end < chunk.page_start) {
        throw new Error(`Invalid page range for manual chunk ${chunk.id}`);
      }
      return chunk;
    });

    if (chunks.length === 0) {
      throw new Error("The manual contains no knowledge chunks");
    }

    const ids = new Set<string>();
    for (const chunk of chunks) {
      if (ids.has(chunk.id)) {
        throw new Error(`Duplicate manual chunk ID: ${chunk.id}`);
      }
      ids.add(chunk.id);
    }

    this.chunks = chunks;
    this.chunksById = new Map(chunks.map((chunk) => [chunk.id, chunk]));
    this.version = `${chunks[0]?.document_id ?? "manual"}:${chunks.length}`;
    this.context = chunks.map(formatChunk).join("\n\n");
  }

  get size() {
    return this.chunks.length;
  }

  hasChunk(id: string) {
    return this.chunksById.has(id);
  }

  getChunk(id: string) {
    return this.chunksById.get(id);
  }

  citations(ids: readonly string[]): Citation[] {
    return ids.map((id) => {
      const chunk = this.chunksById.get(id);
      if (!chunk) {
        throw new Error(`Unknown citation chunk ID: ${id}`);
      }
      return {
        chunkId: chunk.id,
        title: chunk.title,
        chapter: chunk.chapter,
        pages:
          chunk.page_start === chunk.page_end
            ? String(chunk.page_start)
            : `${chunk.page_start}-${chunk.page_end}`,
      };
    });
  }
}

function formatChunk(chunk: ManualChunk) {
  return [
    `<manual_chunk id="${escapeAttribute(chunk.id)}" title="${escapeAttribute(chunk.title)}" chapter="${escapeAttribute(chunk.chapter)}" pages="${chunk.page_start}-${chunk.page_end}" language="${escapeAttribute(chunk.language)}">`,
    chunk.text,
    "</manual_chunk>",
  ].join("\n");
}

function escapeAttribute(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}
