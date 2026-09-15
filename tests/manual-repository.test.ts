import path from "node:path";
import { describe, expect, it } from "vitest";
import { ManualRepository } from "../src/knowledge/manual-repository.js";

const manualPath = path.resolve(
  "knowledge-base",
  "sal",
  "data",
  "sal-guide-chunks.jsonl",
);

describe("ManualRepository", () => {
  it("loads the complete processed SAL manual", () => {
    const manual = new ManualRepository(manualPath);

    expect(manual.size).toBe(58);
    expect(manual.version).toBe("sal-teacher-librarian-guide:58");
    expect(manual.context).toContain("<manual_chunk");
    expect(manual.hasChunk("sal-0423ac330bdd")).toBe(true);
  });

  it("resolves citations with page information", () => {
    const manual = new ManualRepository(manualPath);

    expect(manual.citations(["sal-0423ac330bdd"])).toEqual([
      {
        chunkId: "sal-0423ac330bdd",
        title: "Setting Up a Child-Friendly Library Space",
        chapter: "Chapter 2: Practical School Library Operations",
        pages: "8-9",
      },
    ]);
  });
});
