# SAL WhatsApp Support Assistant

## Implementation, Testing, Validation, and Azure Setup Plan

**Status:** Ready for prototype execution  
**Date:** September 14, 2026  
**Related documents:** `SOLUTION-DESIGN.md`, `STAKEHOLDER-SOLUTION.html`

## 1. Delivery strategy

Development will proceed without waiting for the WhatsApp Cloud API setup.

The sequence is:

```text
Core support service
-> automated synthetic-message tests
-> live Azure integration tests
-> local HTTP test endpoint
-> Postman message simulation
-> WhatsApp webhook integration
-> WhatsApp Business Coexistence or custom staff interface
```

All message sources use the same application entry point:

```ts
interface SupportMessage {
  externalMessageId: string;
  externalUserId: string;
  type: "text" | "voice";
  text?: string;
  audio?: {
    bytes: Uint8Array;
    mimeType: string;
  };
  receivedAt: string;
}

interface SupportAssistant {
  process(message: SupportMessage): Promise<SupportResponse>;
}
```

This allows generated messages, Postman requests, and real WhatsApp webhooks to exercise
the same support behavior.

## 2. Proposed prototype stack

| Area | Technology |
|---|---|
| Runtime | Node.js and TypeScript |
| HTTP API | Fastify |
| Validation | Zod |
| Local database | SQLite using `better-sqlite3` |
| Azure LLM client | Stable OpenAI SDK with `@azure/identity` |
| LLM deployment | GPT-5.6 Luna in Microsoft Foundry |
| Speech transcription | MAI-Transcribe-2 or approved Azure Speech fallback |
| Audio conversion | Local `ffmpeg` process |
| Automated tests | Vitest and Fastify `inject()` |
| Manual API testing | Postman |
| Knowledge source | `knowledge-base\sal\data\sal-guide-chunks.jsonl` |

The Microsoft Azure AI Inference beta SDK was retired on August 26, 2026. The
implementation should use the stable OpenAI-compatible `/openai/v1` API and current
OpenAI SDK rather than adding the retired beta package.

## 3. Implementation plan

### Phase 0: Repository and application foundation

**Tasks**

1. Initialize the Node.js and TypeScript project.
2. Add Fastify, Zod, SQLite, Azure identity, OpenAI SDK, and Vitest dependencies.
3. Establish source folders following the design document.
4. Add environment validation at application startup.
5. Add structured logging with secret and personal-data redaction.
6. Add `/health` and `/ready` endpoints.
7. Add database migrations and an application startup command.

**Deliverables**

- API service starts locally.
- `/health` reports process health.
- `/ready` confirms database, manual, and required configuration readiness.
- SQLite database is created under `data\`.
- Automated test command is available.

**Exit criteria**

- Application starts with valid configuration.
- Application fails visibly with a useful message when required configuration is
  missing.
- No credentials or personal identifiers appear in logs.

### Phase 1: Manual loading and grounded prompt construction

**Tasks**

1. Load `knowledge-base\sal\data\sal-guide-chunks.jsonl` at startup.
2. Validate each line against a Zod schema.
3. Confirm:
   - 58 records are present;
   - IDs are unique;
   - required metadata is present;
   - page ranges are valid;
   - text is not empty.
4. Format each record as a bounded manual chunk with its ID, title, chapter, pages,
   language, and text.
5. Build one stable manual-context string at startup.
6. Calculate and log only aggregate context size information, not manual text.
7. Add a manual version identifier to every generated answer record.

**Deliverables**

- `ManualRepository`
- `ManualChunk` schema
- Stable manual-context builder
- Manual validation tests

**Exit criteria**

- The current bundle loads as exactly 58 valid chunks.
- Invalid, missing, or duplicate records prevent application readiness.
- Every chunk ID can be resolved locally for citation validation.

### Phase 2: Azure LLM integration

**Tasks**

1. Implement `LanguageModelGateway`.
2. Authenticate locally using `DefaultAzureCredential` after `az login`.
3. Authenticate in the hosted environment using managed identity.
4. Use the Foundry project endpoint with `/openai/v1`.
5. Send:
   - support instructions;
   - recent conversation messages;
   - the complete formatted manual;
   - the current user question.
6. Request structured JSON output.
7. Capture model deployment, token usage, latency, and request outcome.
8. Implement timeout handling and bounded retries for transient failures.

**Required model response**

```ts
interface SupportModelResult {
  language: "en" | "sw" | "mixed" | "unknown";
  answer: string;
  supported: boolean;
  citedChunkIds: string[];
  requiresHuman: boolean;
  handoffReason?: string;
}
```

**Local validation**

- Output matches the schema.
- Every cited ID exists in the supplied manual.
- A supported factual answer contains at least one citation.
- An unsupported answer is routed to the approved fallback.
- A handoff recommendation creates a handoff state.

**Deliverables**

- Azure model gateway
- Prompt builder
- Response validator
- Mock model gateway for deterministic tests

**Exit criteria**

- One English and one Kiswahili question succeed against the live Azure deployment.
- Citations resolve to real local chunks.
- Invalid model output is never sent to a user.

### Phase 3: Conversation state and policy routing

**Tasks**

1. Implement contacts, conversations, messages, handoffs, feedback, and audit tables.
2. Implement conversation states:

```text
bot
waiting_for_human
human
closed
```

3. Load a bounded recent conversation window.
4. Add deterministic routing for:
   - explicit human requests;
   - stop and opt-out;
   - conversation already owned by staff;
   - unsupported input;
   - duplicate message IDs;
   - approved safeguarding and emergency patterns.
5. Pause model calls in `waiting_for_human` and `human` states.
6. Add idempotent message processing using `externalMessageId`.

**Deliverables**

- `ConversationService`
- `PolicyRouter`
- `HandoffService`
- SQLite repositories and migrations

**Exit criteria**

- Duplicate input produces no duplicate model call or response.
- Explicit human requests always create handoff.
- Bot remains paused while staff own the conversation.

### Phase 4: Automated synthetic-message harness

This phase starts before WhatsApp access is available.

**Tasks**

1. Create a versioned test-case format:

```json
{
  "id": "library-setup-sw-001",
  "language": "sw",
  "category": "supported",
  "message": "Ninawezaje kupanga maktaba ili watoto wajisikie vizuri?",
  "expectedTopics": ["library_space"],
  "expectedChunkIds": ["sal-0423ac330bdd"],
  "expectedSupported": true,
  "expectedHandoff": false
}
```

2. Generate candidate user messages from the manual using a separate generation
   script.
3. Review generated cases and freeze accepted cases into JSONL fixtures.
4. Add manually authored edge cases and unsupported questions.
5. Implement a runner that:
   - creates a clean temporary SQLite database;
   - sends each message through `SupportAssistant.process`;
   - captures structured results;
   - checks deterministic assertions;
   - produces JSON and HTML reports.
6. Support two modes:
   - `mock`: deterministic model responses for application tests;
   - `azure`: real GPT-5.6 Luna calls for quality evaluation.

**Initial evaluation set**

| Category | Target cases |
|---|---:|
| Supported English questions | 50 |
| Supported Kiswahili questions | 30 |
| English/Kiswahili mixed questions | 10 |
| Multi-turn follow-up questions | 15 |
| Unsupported questions | 15 |
| Explicit human requests | 10 |
| Safeguarding and policy-routing cases | 10 |
| Ambiguous or poorly written messages | 10 |
| **Total** | **150** |

Generated test cases are proposals, not an automatic source of truth. A SAL manual
owner and fluent Kiswahili reviewer approve expected topics, chunks, and behavior.

**Deliverables**

- `tests\fixtures\support-cases.jsonl`
- Synthetic test generator
- Automated evaluation runner
- Machine-readable and stakeholder-readable reports

**Exit criteria**

- All deterministic application tests pass.
- The live Azure evaluation report includes all 150 reviewed cases.
- Every failure identifies the input, expected behavior, actual behavior, cited chunks,
  and model deployment.

### Phase 5: Test-only HTTP API and Postman

This phase provides realistic HTTP testing while Meta setup is pending.

**Development-only endpoint**

```http
POST /api/test/messages
X-Test-Token: <local-test-token>
Content-Type: application/json
```

```json
{
  "externalMessageId": "postman-0001",
  "externalUserId": "demo-user-001",
  "type": "text",
  "text": "How should I arrange books for younger learners?",
  "receivedAt": "2026-09-14T18:00:00Z"
}
```

Example response:

```json
{
  "status": "answered",
  "conversationId": "conversation-id",
  "language": "en",
  "answer": "Arrange books so learners can see and reach them...",
  "citations": [
    {
      "chunkId": "sal-0423ac330bdd",
      "chapter": "Chapter 2: Practical School Library Operations",
      "pages": "8-9"
    }
  ]
}
```

**Voice test endpoint**

```http
POST /api/test/messages/voice
X-Test-Token: <local-test-token>
Content-Type: multipart/form-data
```

Fields:

- `externalMessageId`
- `externalUserId`
- `audio`

**Controls**

- Endpoint exists only when `ENABLE_TEST_ENDPOINTS=true`.
- Endpoint requires `X-Test-Token`.
- Production configuration refuses to start if test endpoints are enabled.
- Remote demo environments should additionally restrict access by network or identity.

**Postman collection**

Create folders for:

1. Health and readiness.
2. English text questions.
3. Kiswahili text questions.
4. Multi-turn conversations.
5. Unsupported questions.
6. Human handoff.
7. Duplicate-message behavior.
8. Voice upload.
9. Invalid requests.
10. Simulated WhatsApp webhook payloads.

Postman tests should assert:

- HTTP status.
- Response schema.
- Supported versus handoff state.
- Citation presence for supported answers.
- No second answer for duplicate message IDs.
- Correct conversation state.

**Exit criteria**

- A tester can execute a complete conversation using only Postman.
- The same user ID preserves conversation context.
- Different user IDs remain isolated.
- Duplicate requests are idempotent.

### Phase 6: Voice processing

**Tasks**

1. Accept local audio fixtures through the test endpoint.
2. Validate file type, size, and configured duration.
3. Convert WhatsApp OGG/Opus audio locally to a format accepted by the selected Azure
   transcription endpoint, such as WAV, MP3, or FLAC.
4. Transcribe using MAI-Transcribe-2 where available.
5. Support English, Kiswahili, and mixed-language recordings.
6. Pass the transcript through the same `SupportAssistant` path as text.
7. Delete all temporary audio files in success and failure paths.
8. Ask for transcript confirmation when names, dates, phone numbers, safeguarding, or
   other consequential details are detected.

**Synthetic voice set**

Create at least 30 reviewed recordings:

- 10 English;
- 10 Kiswahili;
- 5 code-switched;
- 5 noisy or unclear.

Text-to-speech generated audio can provide repeatable baseline coverage. Add a smaller
set recorded by Kenyan English and Kiswahili speakers before user acceptance.

**Exit criteria**

- Voice and text inputs produce the same expected support behavior.
- Temporary audio is removed after every test.
- Unusable audio produces an approved clarification response.
- Consequential transcripts require confirmation.

### Phase 7: WhatsApp Cloud API adapter

Start this phase when Meta setup is available.

**Tasks**

1. Implement webhook verification.
2. Validate incoming webhook signatures according to Meta requirements.
3. Map Meta text payloads to `SupportMessage`.
4. Map Meta audio media IDs to secure media download and `SupportMessage`.
5. Record delivery and failure status callbacks.
6. Send outbound text answers.
7. Add bounded retries for transient delivery failures.
8. Save representative Meta webhook payloads as contract-test fixtures.

The WhatsApp adapter must contain no support-answering logic. It only converts between
Meta payloads and application types.

**Exit criteria**

- Meta text messages pass through the already validated support pipeline.
- Voice memos are downloaded, transcribed, answered, and deleted safely.
- Duplicate webhook delivery does not duplicate answers.
- Delivery failures are visible in logs and message state.

### Phase 8: Staff handoff

**Coexistence path**

If SAL has an eligible WhatsApp Business App Coexistence number:

1. Connect the number to the Cloud API through the approved onboarding flow.
2. Subscribe to staff-message echo events.
3. Mark a conversation `human` when staff reply from WhatsApp Business.
4. Store the staff reply in local conversation history.
5. Keep automated replies paused.
6. Define an approved rule for returning the conversation to bot mode.

**Custom-interface path**

If SAL has no Coexistence-enabled number:

1. Build the protected staff conversation list.
2. Allow staff to claim, reply, release, and close conversations.
3. Send staff replies through the WhatsApp Cloud API.
4. Record staff identity and audit events.

**Exit criteria**

- Staff can receive and answer a handed-off conversation.
- Bot never interrupts an active staff conversation.
- Every staff answer is captured in the conversation audit history.

## 4. Testing plan

### 4.1 Test layers

| Layer | Purpose | Azure required |
|---|---|---:|
| Unit tests | Schemas, rules, citation validation, formatting, state transitions | No |
| Repository tests | SQLite migrations, idempotency, conversation isolation | No |
| Component tests | Complete support flow with mocked model and speech gateways | No |
| Contract tests | Test HTTP and saved WhatsApp payload compatibility | No |
| Synthetic quality tests | Grounding, language, refusal, and handoff quality | Yes |
| Speech integration tests | Real transcription of reviewed audio fixtures | Yes |
| Postman tests | Black-box API behavior | Optional |
| WhatsApp sandbox tests | Real Meta webhook and outbound delivery | Yes, plus Meta |
| User acceptance tests | SAL staff review of real workflows | Yes |

### 4.2 Unit-test coverage

Cover:

- Manual JSONL parsing and validation.
- Duplicate chunk IDs.
- Citation resolution.
- Response schema validation.
- Supported response without citations.
- Explicit handoff phrases.
- Stop and opt-out behavior.
- Conversation transitions.
- Duplicate external message IDs.
- Prompt construction without phone numbers.
- Audio filename safety and cleanup.
- Azure timeout and retry classification.
- Meta webhook mapping after integration.

### 4.3 Deterministic component tests

Use mock gateways:

```ts
class MockLanguageModelGateway implements LanguageModelGateway {}
class MockSpeechTranscriber implements SpeechTranscriber {}
class FakeMessagingProvider implements MessagingProvider {}
```

These tests verify application behavior without depending on model variability,
network access, Azure quota, or Meta availability.

### 4.4 Live-model evaluation

Run live Azure evaluations separately from the normal test suite:

```text
npm test
npm run test:integration
npm run eval:azure
```

The live evaluation must:

- record model and deployment names;
- record prompt version and manual version;
- preserve structured outputs;
- calculate metrics;
- avoid storing phone numbers or real user data;
- support comparison between prompt versions.

Do not fail normal builds because one generative answer uses different wording. Assert
grounding, expected topics or chunks, language, supported status, handoff behavior, and
required facts instead of exact prose.

### 4.5 Postman test progression

Use Postman in this order:

1. One direct English question.
2. One direct Kiswahili question.
3. A three-message follow-up conversation.
4. An unsupported question.
5. An explicit human request.
6. The same message ID twice.
7. Two different simulated users.
8. Invalid and missing fields.
9. Voice upload.
10. Saved WhatsApp-shaped webhook fixtures.

Export the collection and non-secret environment into the repository. Keep tokens,
keys, and real phone numbers out of exported files.

## 5. Validation plan

### 5.1 Functional gates

| Measure | Prototype gate |
|---|---:|
| Current manual chunks loaded | 58 |
| Valid citations for supported answers | 100% |
| Explicit human requests transferred | 100% |
| Safeguarding cases routed by approved policy | 100% |
| Duplicate messages producing duplicate answers | 0% |
| Conversation isolation failures | 0 |
| Temporary audio remaining after processing | 0 files |

### 5.2 Quality gates

| Measure | Initial target |
|---|---:|
| Correctly grounded supported answers | At least 90% |
| Unsupported questions refused or handed off | At least 95% |
| Response language matches user language | At least 95% |
| Expected evidence included in cited chunks | At least 90% |
| Materially incorrect procedure, number, or requirement | 0 accepted cases |
| Consequential voice transcript requiring confirmation | 100% |

### 5.3 Performance and cost observations

Record rather than prematurely optimize:

- text response p50 and p95 latency;
- voice transcription p50 and p95 latency;
- model input and output tokens;
- model cost per answered message;
- speech cost per voice minute;
- WhatsApp delivery latency;
- handoff rate;
- model and transcription failure rate.

Provisional prototype objectives:

- p95 text processing under 15 seconds;
- p95 voice processing under 30 seconds for short memos;
- average Luna generation cost below $0.01 per answered text message.

These objectives should be revised using measured results from the target Azure region.

### 5.4 Human validation

SAL reviewers evaluate:

- factual correctness;
- completeness;
- clarity for the intended audience;
- English and Kiswahili naturalness;
- citation relevance;
- safeguarding appropriateness;
- whether handoff occurred at the right time.

Each reviewed case is marked:

```text
pass
minor_revision
fail_grounding
fail_language
fail_safety
fail_handoff
```

Any `fail_safety` or materially incorrect procedure blocks release regardless of the
aggregate score.

### 5.5 Release decision

The prototype is ready for controlled external testing when:

1. Functional gates pass.
2. Quality targets pass on the frozen evaluation set.
3. SAL approves safeguarding and handoff messages.
4. A fluent Kiswahili reviewer approves multilingual behavior.
5. Azure budgets, access, and deployments are configured.
6. Logs and stored prompts contain no unexpected personal data.
7. The Postman collection passes against the candidate deployment.
8. Staff handoff works through Coexistence or the custom interface.

## 6. Actions required from the Azure owner

### Step 1: Select subscription, region, and data-processing boundary

1. Choose the Azure subscription used for the prototype.
2. Confirm whether processing may use:
   - Global Standard;
   - a specific data zone;
   - a specific Azure region.
3. Select a region where the approved GPT-5.6 Luna and speech capabilities are
   available.
4. Record the decision because deployment availability and data-processing geography
   depend on the deployment type.

For a low-volume prototype, start with a pay-per-token Standard or Global Standard
deployment rather than provisioned throughput.

### Step 2: Create the resource group

Suggested naming:

```text
Resource group: rg-sal-support-dev
Location:       selected approved region
Tags:
  application = sal-support
  environment = dev
  owner = <team>
  cost-center = <value>
```

### Step 3: Create a Microsoft Foundry resource and project

Suggested naming:

```text
Foundry resource: sal-support-ai-dev
Foundry project:  sal-support-dev
```

Copy and provide the project endpoint:

```text
https://<resource>.services.ai.azure.com/api/projects/<project>
```

Do not send credentials through email, chat, or source control.

### Step 4: Deploy GPT-5.6 Luna

1. Open the Microsoft Foundry model catalog.
2. Find GPT-5.6 Luna.
3. Confirm model availability for the selected region and deployment type.
4. Select a pay-per-token deployment.
5. Use a stable deployment name:

```text
sal-support-luna
```

6. Retain the default content filter initially.
7. Allocate the smallest practical quota for prototype concurrency.
8. Confirm deployment state is `Succeeded`.
9. Test one English and one Kiswahili prompt in the Foundry playground.
10. Provide engineering:
    - project endpoint;
    - deployment name;
    - approved authentication method;
    - applicable token quota.

The application uses the deployment name, not the underlying catalog model name, in
the API request.

### Step 5: Configure Azure identity and access

For developers:

1. Assign the minimum Foundry role needed to use the project, normally `Foundry User`.
2. Developers authenticate locally with:

```text
az login
```

3. The application uses `DefaultAzureCredential`.

For the hosted API:

1. Enable a system-assigned or user-assigned managed identity.
2. Grant that identity the minimum required Foundry inference access.
3. Avoid storing a Foundry API key when managed identity is available.
4. If an API key is temporarily required, store it in the hosting secret store and
   rotate it after the prototype.

The Foundry authentication scope used by the SDK is:

```text
https://ai.azure.com/.default
```

### Step 6: Create the Speech resource

1. Create a Microsoft Foundry resource for Speech in a region supporting the selected
   transcription model.
2. Confirm whether `MAI-Transcribe-2` is available.
3. If available, enable it through the Fast Transcription API using enhanced mode.
4. Otherwise, approve an Azure Speech fallback supporting `en-KE` and `sw-KE`.
5. Provide engineering:
   - speech endpoint;
   - speech region;
   - approved authentication method;
   - selected model name.

MAI-Transcribe-2 accepts WAV, MP3, or FLAC through its documented transcription flow.
The API service will convert WhatsApp OGG/Opus audio locally before transcription.

### Step 7: Review content filters

1. Begin with the default input and output filters.
2. Test normal library questions.
3. Test approved safeguarding examples.
4. Confirm legitimate safeguarding reports are routed without losing the user's
   ability to ask for help.
5. Record any custom filter configuration and attach it to the deployment.

Do not disable safety filters globally merely to make one test pass. Adjust prompts,
routing, or approved configuration deliberately.

### Step 8: Configure quota and cost controls

1. Review available model quota for the selected model, region, and deployment type.
2. Start with low prototype capacity.
3. Set an Azure budget for the resource group.
4. Add alerts at suitable thresholds, for example:
   - 50%;
   - 80%;
   - 100%.
5. If AI Gateway token management is available in the environment, set a conservative
   project-level token limit.
6. Review actual spend after the first automated Azure evaluation.

### Step 9: Provide a secure configuration handoff

Engineering needs these non-secret values:

```text
AZURE_FOUNDRY_PROJECT_ENDPOINT
AZURE_LLM_DEPLOYMENT=sal-support-luna
AZURE_SPEECH_ENDPOINT
AZURE_SPEECH_REGION
AZURE_SPEECH_MODEL
AZURE_TENANT_ID
```

Authentication should use the developer identity locally and managed identity in the
hosted environment. If temporary keys are required, place them directly in the approved
secret store rather than sharing them as document content.

## 7. Work that can begin before Azure is ready

Engineering can complete:

- project scaffolding;
- manual loading and validation;
- SQLite migrations;
- conversation states;
- policy routing;
- citation validation;
- mock LLM and speech gateways;
- generated-message fixtures;
- deterministic automated tests;
- test HTTP endpoints;
- Postman collection;
- WhatsApp payload adapter contracts using sanitized fixtures.

The first live Azure dependency is Phase 2's integration check. All earlier application
behavior can be built and tested with mocks.

## 8. Work that can begin before WhatsApp is ready

The complete support experience can be exercised through:

```text
Automated test runner
-> SupportAssistant.process()
-> mocked or live Azure gateway
-> SQLite
-> evaluation report
```

and then:

```text
Postman
-> development-only test endpoint
-> SupportAssistant.process()
-> live Azure
-> JSON response
```

When Meta setup is complete, only the transport adapter changes:

```text
WhatsApp webhook
-> WhatsApp adapter
-> SupportAssistant.process()
```

The prompt, manual loading, conversation state, policy, validation, and Azure behavior
remain the same.

## 9. Definition of prototype complete

The prototype is complete when:

- automated deterministic tests pass;
- the reviewed 150-case Azure evaluation meets the release gates;
- Postman can exercise text, Kiswahili, follow-up, refusal, duplicate, handoff, and
  voice scenarios;
- the manual is cited correctly;
- temporary voice files are deleted;
- Azure cost and latency are measured;
- WhatsApp text and voice messages work when Meta access becomes available;
- staff handoff works through Coexistence or the custom staff interface;
- SAL stakeholders approve the controlled pilot.

## 10. Azure references

- [Set up Microsoft Foundry resources](https://learn.microsoft.com/en-us/azure/foundry/tutorials/quickstart-create-foundry-resources)
- [Deploy Microsoft Foundry Models](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/how-to/deploy-foundry-models)
- [Microsoft Foundry deployment overview](https://learn.microsoft.com/en-us/azure/foundry/concepts/deployments-overview)
- [Microsoft Foundry reasoning model authentication](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/how-to/use-chat-reasoning)
- [Role-based access control for Microsoft Foundry](https://learn.microsoft.com/en-us/azure/foundry/concepts/rbac-foundry)
- [MAI-Transcribe-2](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/mai-transcribe)
- [Microsoft Foundry content filtering](https://learn.microsoft.com/en-us/azure/foundry-classic/foundry-models/concepts/content-filter)
- [Manage Azure OpenAI quota](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/quota)
