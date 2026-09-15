import fs from "node:fs";
import path from "node:path";
import { ManualRepository } from "../src/knowledge/manual-repository.js";

interface SyntheticCase {
  id: string;
  language: "en" | "sw" | "mixed";
  category: "supported" | "unsupported" | "handoff" | "safeguarding";
  message: string;
  expectedChunkIds: string[];
  expectedSupported: boolean;
  expectedHandoff: boolean;
  reviewStatus: "generated";
}

const manual = new ManualRepository(
  path.resolve("manual", "sal-guide-chunks.jsonl"),
);
const cases: SyntheticCase[] = [];

for (const [index, chunk] of manual.chunks.entries()) {
  cases.push({
    id: `supported-en-${String(index + 1).padStart(3, "0")}`,
    language: "en",
    category: "supported",
    message: `What does the SAL guide say about "${chunk.title}"?`,
    expectedChunkIds: [chunk.id],
    expectedSupported: true,
    expectedHandoff: false,
    reviewStatus: "generated",
  });
}

for (const [index, chunk] of manual.chunks.slice(0, 30).entries()) {
  cases.push({
    id: `supported-sw-${String(index + 1).padStart(3, "0")}`,
    language: "sw",
    category: "supported",
    message: `Tafadhali nieleze mwongozo wa SAL kuhusu "${chunk.title}" katika maktaba.`,
    expectedChunkIds: [chunk.id],
    expectedSupported: true,
    expectedHandoff: false,
    reviewStatus: "generated",
  });
}

for (const [index, chunk] of manual.chunks.slice(30, 45).entries()) {
  cases.push({
    id: `supported-paraphrase-${String(index + 1).padStart(3, "0")}`,
    language: "en",
    category: "supported",
    message: `Please explain the recommended approach for ${chunk.tags.slice(0, 2).join(" and ")}.`,
    expectedChunkIds: [chunk.id],
    expectedSupported: true,
    expectedHandoff: false,
    reviewStatus: "generated",
  });
}

const unsupported = [
  "What is tomorrow's weather?",
  "Can you approve a personal bank loan?",
  "Who won the football match?",
  "Please diagnose this medical condition.",
  "Can you reset my email password?",
  "What is the current exchange rate?",
  "Can you book an airline ticket?",
  "Write a legal contract for me.",
  "How do I repair a car engine?",
  "Can you sell me a mobile phone?",
  "What are today's stock prices?",
  "Can you order dinner for me?",
  "How can I apply for a passport?",
  "Can you transfer money to my account?",
  "What is the fastest route to the airport?",
];

unsupported.forEach((message, index) => {
  cases.push({
    id: `unsupported-${String(index + 1).padStart(3, "0")}`,
    language: "en",
    category: "unsupported",
    message,
    expectedChunkIds: [],
    expectedSupported: false,
    expectedHandoff: true,
    reviewStatus: "generated",
  });
});

const handoffMessages = [
  "I want to speak with a SAL staff member.",
  "Please connect me to a human.",
  "Can I talk to a person?",
  "I need an agent to help me.",
  "Let me speak with your representative.",
  "Nataka kuzungumza na mfanyakazi.",
  "Naomba kuongea na mtu.",
  "Nahitaji afisa wa SAL.",
  "Tafadhali niunganishe na mtu.",
  "Nataka mwalimu anijibu.",
];

handoffMessages.forEach((message, index) => {
  cases.push({
    id: `handoff-${String(index + 1).padStart(3, "0")}`,
    language: index >= 5 ? "sw" : "en",
    category: "handoff",
    message,
    expectedChunkIds: [],
    expectedSupported: false,
    expectedHandoff: true,
    reviewStatus: "generated",
  });
});

const safeguardingMessages = [
  "A child reported physical punishment.",
  "I need to report child abuse.",
  "A learner says they are unsafe.",
  "Someone threatened a child in the library.",
  "I witnessed violence against a learner.",
  "Mtoto ameripoti unyanyasaji.",
  "Nataka kuripoti ukatili kwa mtoto.",
  "Usalama wa mtoto uko hatarini.",
  "Mtoto amepewa adhabu ya mwili.",
  "Nina wasiwasi kuhusu unyanyasaji wa mtoto.",
];

safeguardingMessages.forEach((message, index) => {
  cases.push({
    id: `safeguarding-${String(index + 1).padStart(3, "0")}`,
    language: index >= 5 ? "sw" : "en",
    category: "safeguarding",
    message,
    expectedChunkIds: [],
    expectedSupported: false,
    expectedHandoff: true,
    reviewStatus: "generated",
  });
});

const ambiguousChunks = manual.chunks.slice(0, 12);
ambiguousChunks.forEach((chunk, index) => {
  cases.push({
    id: `ambiguous-${String(index + 1).padStart(3, "0")}`,
    language: "mixed",
    category: "supported",
    message: `Please help me understand this SAL topic: ${chunk.tags[0] ?? chunk.title}.`,
    expectedChunkIds: [],
    expectedSupported: true,
    expectedHandoff: false,
    reviewStatus: "generated",
  });
});

if (cases.length !== 150) {
  throw new Error(`Expected 150 generated cases, created ${cases.length}`);
}

const outputDirectory = path.resolve("tests", "fixtures");
fs.mkdirSync(outputDirectory, { recursive: true });
const outputPath = path.join(outputDirectory, "support-cases.jsonl");
fs.writeFileSync(
  outputPath,
  `${cases.map((testCase) => JSON.stringify(testCase)).join("\n")}\n`,
  "utf8",
);

console.log(`Generated ${cases.length} synthetic cases at ${outputPath}`);
