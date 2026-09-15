# SAGE

A grounded knowledge assistant that gives Start A Library Trust teacher-librarians
concise, source-backed guidance on library operations, with human escalation.

The API-first prototype supports text and voice requests. It runs locally in mock
mode and can use GPT-5.6 Luna and MAI-Transcribe-2 through Microsoft Foundry when
Azure configuration is supplied.

The generated SAL Teacher Librarian Guide ingestion bundle is documented in
[`knowledge-base/sal/README.md`](knowledge-base/sal/README.md).

## Start locally

```powershell
Copy-Item .env.example .env
```

Set a random `TEST_API_TOKEN` and development `CONTACT_HASH_KEY`, then run:

```powershell
npm install
npm run generate:cases
npm test
npm start
```

Check:

```text
GET http://127.0.0.1:3000/health
GET http://127.0.0.1:3000/ready
```

Ask one question from another terminal:

```powershell
Copy-Item ask.config.example.json ask.config.json
notepad ask.config.json
npm run ask -- "How should I organize library books?"
```

Set `testToken` in `ask.config.json` to the `TEST_API_TOKEN` value from `.env`.
The local `.env`, `ask.config.json`, SQLite data, dependencies, and build output
are excluded from source control.

If the configured user is waiting for human handoff, return control to the chatbot:

```powershell
npm run reset-conversation
```

To reset another test user:

```powershell
npm run reset-conversation -- "another-user-id"
```

## Configuration

Mock mode is the default:

```env
LLM_PROVIDER=mock
SPEECH_PROVIDER=mock
```

For Azure mode, authenticate with `az login` or configure API keys, then set:

```env
LLM_PROVIDER=azure
AZURE_OPENAI_ENDPOINT=https://<resource>.openai.azure.com
AZURE_LLM_DEPLOYMENT=<deployment-name>

SPEECH_PROVIDER=azure
AZURE_SPEECH_ENDPOINT=https://<speech-resource>.cognitiveservices.azure.com
AZURE_SPEECH_MODEL=MAI-Transcribe-2
```

See [`LOCAL-AZURE-SETUP.md`](LOCAL-AZURE-SETUP.md) for the detailed setup and
Postman instructions.

## Validation

```powershell
npm run typecheck
npm test
npm run build
npm run eval:synthetic
```

Generated evaluation reports are written to `reports\` and are excluded from source
control.
