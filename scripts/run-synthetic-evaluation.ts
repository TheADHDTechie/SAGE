import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SupportAssistant } from "../src/application/support-assistant.js";
import { loadConfig } from "../src/config.js";
import { AzureLanguageModelGateway } from "../src/gateways/azure-language-model.js";
import { MockLanguageModelGateway } from "../src/gateways/mock-language-model.js";
import { ConversationStore } from "../src/infrastructure/database.js";
import { ManualRepository } from "../src/knowledge/manual-repository.js";

interface SyntheticCase {
  id: string;
  language: string;
  category: string;
  message: string;
  expectedChunkIds: string[];
  expectedSupported: boolean;
  expectedHandoff: boolean;
}

interface EvaluationResult extends SyntheticCase {
  actualStatus: string;
  actualCitations: string[];
  actualHandoff: boolean;
  expectedEvidenceFound: boolean;
  passed: boolean;
}

interface EvaluationReport {
  generatedAt: string;
  provider: string;
  deployment: string;
  manualVersion: string;
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  results: EvaluationResult[];
}

const config = loadConfig({
  ...process.env,
  ENABLE_TEST_ENDPOINTS: "false",
});
const manual = new ManualRepository(config.MANUAL_PATH);
const temporaryDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), "sal-evaluation-"),
);
const store = new ConversationStore(
  path.join(temporaryDirectory, "evaluation.db"),
  config.CONTACT_HASH_KEY,
);
const gateway =
  config.LLM_PROVIDER === "azure"
    ? new AzureLanguageModelGateway(config)
    : new MockLanguageModelGateway(manual.chunks);
const assistant = new SupportAssistant(manual, store, gateway);
const evaluationDelayMs =
  config.LLM_PROVIDER === "azure"
    ? Number.parseInt(process.env.EVALUATION_DELAY_MS ?? "7000", 10)
    : 0;

if (!Number.isFinite(evaluationDelayMs) || evaluationDelayMs < 0) {
  throw new Error("EVALUATION_DELAY_MS must be a non-negative integer");
}

const fixturePath = path.resolve("tests", "fixtures", "support-cases.jsonl");
if (!fs.existsSync(fixturePath)) {
  throw new Error("Synthetic fixtures are missing. Run npm run generate:cases.");
}

const cases = fs
  .readFileSync(fixturePath, "utf8")
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line) as SyntheticCase);

const results: EvaluationResult[] = [];
try {
  for (const testCase of cases) {
    const response = await assistant.process({
      externalMessageId: `evaluation-${testCase.id}`,
      externalUserId: `evaluation-user-${testCase.id}`,
      type: "text",
      text: testCase.message,
      receivedAt: new Date().toISOString(),
    });

    const actualCitations =
      response.status === "answered"
        ? response.citations.map((citation) => citation.chunkId)
        : [];
    const actualHandoff =
      response.status === "handoff" || response.status === "human_active";
    const expectedEvidenceFound =
      testCase.expectedChunkIds.length === 0 ||
      testCase.expectedChunkIds.some((id) => actualCitations.includes(id));

    results.push({
      ...testCase,
      actualStatus: response.status,
      actualCitations,
      actualHandoff,
      expectedEvidenceFound,
      passed:
        actualHandoff === testCase.expectedHandoff &&
        expectedEvidenceFound,
    });

    if (evaluationDelayMs > 0) {
      await delay(evaluationDelayMs);
    }
  }
} finally {
  store.close();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}

const passed = results.filter((result) => result.passed).length;
const report: EvaluationReport = {
  generatedAt: new Date().toISOString(),
  provider: config.LLM_PROVIDER,
  deployment: gateway.deploymentName,
  manualVersion: manual.version,
  total: results.length,
  passed,
  failed: results.length - passed,
  passRate: passed / results.length,
  results,
};

const reportDirectory = path.resolve("reports");
fs.mkdirSync(reportDirectory, { recursive: true });
fs.writeFileSync(
  path.join(reportDirectory, "synthetic-evaluation.json"),
  JSON.stringify(report, null, 2),
  "utf8",
);
fs.writeFileSync(
  path.join(reportDirectory, "synthetic-evaluation.html"),
  renderHtml(report),
  "utf8",
);

console.log(
  `Synthetic evaluation: ${passed}/${results.length} passed (${(report.passRate * 100).toFixed(1)}%)`,
);
if (report.failed > 0) {
  process.exitCode = 1;
}

function renderHtml(report: EvaluationReport) {
  const failedRows = report.results
    .filter((result) => !result.passed)
    .map(
      (result) =>
        `<tr><td>${escapeHtml(result.id)}</td><td>${escapeHtml(result.message)}</td><td>${escapeHtml(result.actualStatus)}</td><td>${escapeHtml(result.actualCitations.join(", "))}</td></tr>`,
    )
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>SAL synthetic evaluation</title>
  <style>
    body{font:15px/1.5 system-ui;margin:40px;color:#17352c}
    .score{font-size:32px;font-weight:800;color:#087f5b}
    table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccdcd5;padding:8px;text-align:left}
    th{background:#075f46;color:white}
  </style>
</head>
<body>
  <h1>SAL synthetic evaluation</h1>
  <p class="score">${report.passed}/${report.total} passed</p>
  <p>Provider: ${escapeHtml(report.provider)} · Deployment: ${escapeHtml(report.deployment)} · Manual: ${escapeHtml(report.manualVersion)}</p>
  <h2>Failures</h2>
  <table><thead><tr><th>ID</th><th>Message</th><th>Status</th><th>Citations</th></tr></thead><tbody>${failedRows || "<tr><td colspan=\"4\">None</td></tr>"}</tbody></table>
</body>
</html>`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
