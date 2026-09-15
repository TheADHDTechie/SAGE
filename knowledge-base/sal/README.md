# SAL Teacher Librarian Guide knowledge-base bundle

This bundle partitions the **SAL Final Teacher Librarian Guide** into provider-neutral,
semantically bounded records for a prototype support chatbot.

## Files

- `data/sal-guide-chunks.jsonl` — primary ingestion file; one JSON object per chunk.
- `data/sal-guide-chunks.csv` — spreadsheet-friendly review copy.
- `schema/sal-topic-taxonomy.json` — top-level and leaf topic taxonomy.
- `schema/sal-ingestion-summary.json` — counts and quality-control statistics.
- `tools/build_sal_knowledge_base.py` — repeatable builder for this version of the manual.

## Recommended prototype flow

1. Read each line from `data/sal-guide-chunks.jsonl`.
2. Generate an embedding from the `text` field using any embedding provider.
3. Store the embedding together with the complete JSON record.
4. At query time, retrieve the most similar 3–5 chunks.
5. Give the chatbot the retrieved `text`, `title`, `page_start`, and `page_end`.
6. Require responses to cite the manual title and PDF page numbers.
7. If retrieval confidence is low, respond that the manual does not contain enough
   information rather than inventing an answer.

## Chunking approach

- Chapter and section boundaries are preserved.
- Activity guides, templates, posters, pledges and safeguarding guidance are separate
  content types so retrieval can be filtered.
- Sections longer than 650 words are split with approximately 70 words of overlap.
- Every record includes topic, tags, chapter, section, language, page range and extraction
  method.
- Image-only appendix pages were reviewed and transcribed into searchable text. These
  records are marked `manual_image_transcription` and should receive a final human proofread
  before production use.

## Minimal database schema

Store these fields at minimum:

`id`, `text`, `embedding`, `title`, `topic`, `tags`, `page_start`, `page_end`,
`content_type`, `language`, `source_file`.

The JSONL is independent of the LLM and vector database. It can be loaded into a local
FAISS/Chroma prototype, PostgreSQL with pgvector, Azure AI Search, Pinecone, Qdrant, Weaviate,
or another vector-capable store without changing the source records.
