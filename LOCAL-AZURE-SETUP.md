# Run SAL Support Locally and Configure Azure

**Updated:** September 15, 2026

## 1. Run locally without Azure

This mode uses the local mock language and speech providers. It is the fastest way to
verify the service and Postman collection.

### Prerequisites

- Node.js
- npm
- FFmpeg for later audio testing
- Postman

This development machine already has Node.js, npm, and FFmpeg available.

### Install and configure

Open PowerShell:

```powershell
Set-Location C:\Users\nouromar\source\repos\hackathon\SAGE
Copy-Item .env.example .env
notepad .env
```

Set these values in `.env`:

```env
NODE_ENV=development
HOST=127.0.0.1
PORT=3000

DATA_DIR=.\data
MANUAL_PATH=.\knowledge-base\sal\data\sal-guide-chunks.jsonl
CONTACT_HASH_KEY=replace-with-a-long-random-local-value

LLM_PROVIDER=mock
SPEECH_PROVIDER=mock

ENABLE_TEST_ENDPOINTS=true
TEST_API_TOKEN=replace-with-a-random-postman-token
```

Do not commit `.env`. It is already excluded by `.gitignore`.

Install and verify:

```powershell
npm install
npm run generate:cases
npm run typecheck
npm test
npm run eval:synthetic
```

Expected results:

- 44 automated tests pass.
- 150 generated message scenarios pass in mock mode.
- Evaluation reports are written to `reports\`.

### Start the API

```powershell
npm start
```

Keep this PowerShell window open. The service listens on:

```text
http://127.0.0.1:3000
```

Verify in a second PowerShell window:

```powershell
Invoke-RestMethod http://127.0.0.1:3000/health
Invoke-RestMethod http://127.0.0.1:3000/ready
```

The readiness response should include:

```json
{
  "status": "ready",
  "manualChunks": 58,
  "manualVersion": "sal-teacher-librarian-guide:58",
  "llmProvider": "mock"
}
```

## 2. Test with Postman

Import:

```text
postman\SAL-Support.postman_collection.json
postman\SAL-Support.postman_environment.json
```

Select the **SAL Support - Local** environment.

Set:

```text
baseUrl  = http://127.0.0.1:3000
testToken = the exact TEST_API_TOKEN value from .env
```

Run requests in this order:

1. **Health**
2. **Ready**
3. **English question**
4. **Kiswahili question**
5. **Human handoff**
6. **Duplicate message** twice
7. **Voice fixture**

For **Voice fixture** in mock mode:

1. Create a UTF-8 text file such as `voice-fixture.txt`.
2. Put a transcript in the file:

```text
How should I organize library books?
```

3. In the Postman request, select this file for the `audio` form-data field.
4. Keep its content type as `text/plain`.

Mock speech treats the file contents as the transcript. When Azure Speech is enabled,
select a real audio file instead.

### Direct Postman-style request from PowerShell

```powershell
$headers = @{
  "X-Test-Token" = "your-test-token"
}

$body = @{
  externalMessageId = [guid]::NewGuid().ToString()
  externalUserId = "local-user-001"
  type = "text"
  text = "How should I set up a child-friendly library space?"
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:3000/api/test/messages `
  -Headers $headers `
  -ContentType application/json `
  -Body $body
```

## 3. Configure the Azure language model

### Azure permissions

The Azure owner needs permission to:

- Create a resource group and Microsoft Foundry project.
- Create model deployments.
- Assign Azure roles.

The developer account used by `az login` needs inference access on the Foundry
resource. Assign **Cognitive Services User** for keyless inference. Project users can
also be assigned **Foundry User** so they can access the Foundry project.

### Create the Foundry project

Using the Microsoft Foundry portal:

1. Sign in to Microsoft Foundry.
2. Ensure the **New Foundry** experience is selected.
3. Select the project picker and choose **Create new project**.
4. Enter:

```text
Project name: sal-support-dev
Resource group: rg-sal-support-dev
Foundry resource: sal-support-ai-dev
```

5. Under advanced options, select the approved subscription and region.
6. Create the project and wait for provisioning to finish.

Model availability and deployment types differ by region. Select a region and
deployment type that satisfy the organization's data-residency rules.

### Deploy the language model

1. In Foundry, open **Discover > Models**.
2. Find **GPT-5.6 Luna** if it is available in the selected region.
3. Select **Deploy > Custom settings**.
4. Use this deployment name:

```text
sal-support-luna
```

5. Select a pay-per-token Standard or Global Standard deployment approved by the
   organization.
6. Keep the default content filter for the first prototype.
7. Create the deployment.
8. Confirm deployment status is **Succeeded**.
9. Test one English and one Kiswahili question in the Foundry playground.

If GPT-5.6 Luna is unavailable, deploy another approved model that supports structured
JSON-schema output and set `AZURE_LLM_DEPLOYMENT` to that deployment name.

### Copy the project endpoint

From the Foundry project overview, copy the project endpoint. It should resemble:

```text
https://<resource>.services.ai.azure.com/api/projects/<project>
```

Do not add `/openai/v1`; the application adds that path.

### Configure keyless local authentication

Install or update Azure CLI if needed. Current Foundry project CLI commands require
Azure CLI 2.80.0 or later:

```powershell
az version
az upgrade
az login
az account set --subscription "<subscription-name-or-id>"
```

On the Foundry resource:

1. Open **Access control (IAM)**.
2. Select **Add role assignment**.
3. Assign **Cognitive Services User** to your developer account.
4. Optionally assign **Foundry User** at the project or resource scope for portal and
   project access.
5. Wait several minutes for the assignment to propagate.

Update `.env`:

```env
LLM_PROVIDER=azure
AZURE_OPENAI_ENDPOINT=
AZURE_FOUNDRY_PROJECT_ENDPOINT=https://<resource>.services.ai.azure.com/api/projects/<project>
AZURE_LLM_DEPLOYMENT=sal-support-luna
AZURE_OPENAI_API_KEY=
EVALUATION_DELAY_MS=7000
```

Leaving `AZURE_OPENAI_API_KEY` empty tells the application to use the identity from
`az login` through `DefaultAzureCredential`.

### Temporary API-key option

For a quick prototype, copy the model/resource key from Foundry and set:

```env
AZURE_OPENAI_API_KEY=<key>
```

Keyless Microsoft Entra authentication is preferred for shared or hosted
environments. Never commit or place a key in the Postman collection.

### Test the Azure LLM

Restart the service after editing `.env`:

```powershell
npm start
```

Check:

```powershell
Invoke-RestMethod http://127.0.0.1:3000/ready
```

The response should show:

```json
{
  "llmProvider": "azure"
}
```

Run the Postman **English question** and **Kiswahili question** requests. Then run the
complete live evaluation:

```powershell
npm run eval:synthetic
```

Live evaluation invokes Azure for all generated cases and therefore consumes tokens.
With a 150,000 tokens-per-minute deployment and the full manual in each request, keep
the default seven-second delay between evaluation cases. Interactive Postman testing
does not require additional pacing.

## 4. Configure the local WhatsApp callback

### Enable WhatsApp

Create random values for the callback verification token and staff API token. Add
the Meta app and phone configuration to `.env`:

```env
WHATSAPP_ENABLED=true
WHATSAPP_VERIFY_TOKEN=<random-value-you-create>
META_APP_SECRET=<Meta-App-Secret>
WHATSAPP_ACCESS_TOKEN=<Meta-access-token>
WHATSAPP_PHONE_NUMBER_ID=<WhatsApp-phone-number-id>
WHATSAPP_GRAPH_API_VERSION=v26.0
WHATSAPP_GRAPH_BASE_URL=https://graph.facebook.com
WHATSAPP_TIMEOUT_MS=15000
WHATSAPP_MARK_MESSAGES_READ=true
STAFF_API_TOKEN=<another-random-value>
```

`WHATSAPP_VERIFY_TOKEN` is a value you create and enter in both `.env` and the Meta
callback form. It is not the access token.

For real voice notes, also configure:

```env
SPEECH_PROVIDER=azure
AZURE_SPEECH_ENDPOINT=<Azure-Speech-endpoint>
AZURE_SPEECH_KEY=<optional-key>
```

When `SPEECH_PROVIDER=mock`, real WhatsApp audio cannot be transcribed and the user
receives a request to resend or type the question.

### Expose the service through HTTPS

Start SAGE:

```powershell
npm start
```

Install and authenticate ngrok in another PowerShell window:

```powershell
winget install ngrok -s msstore
ngrok config add-authtoken "<ngrok-auth-token>"
ngrok http 3000
```

Copy the public HTTPS URL and append:

```text
/webhooks/whatsapp
```

For example:

```text
https://<generated-host>.ngrok.app/webhooks/whatsapp
```

### Register the callback in Meta

In the Meta Developer dashboard:

1. Open the application and its WhatsApp configuration.
2. Edit the webhook callback.
3. Enter the public callback URL.
4. Enter the exact `WHATSAPP_VERIFY_TOKEN` value.
5. Verify and save the callback.
6. Subscribe to the `messages` webhook field.

Keep ngrok and SAGE running while testing. If the public tunnel URL changes, update
the callback URL in Meta.

### Return a conversation to the chatbot

The staff endpoint closes the active human-handoff conversation. The next message
from that WhatsApp user starts a fresh chatbot conversation:

```powershell
$headers = @{
  Authorization = "Bearer <STAFF_API_TOKEN>"
}
$body = @{
  externalUserId = "254700000001"
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:3000/api/staff/conversations/reset `
  -Headers $headers `
  -ContentType application/json `
  -Body $body
```

## 5. Configure Azure Speech

Voice support is optional for the first text demo and can be enabled separately.

### Create the Speech resource

1. In Azure portal, create a **Microsoft Foundry resource for Speech**.
2. Use the prototype resource group:

```text
Resource group: rg-sal-support-dev
Suggested name: sal-support-speech-dev
```

3. Select a region supporting the Fast Transcription API and MAI-Transcribe-2.
4. Complete deployment.
5. Open **Keys and Endpoint**.
6. Copy the custom endpoint. It should resemble:

```text
https://<speech-resource>.cognitiveservices.azure.com
```

MAI-Transcribe-2 is currently a preview capability. Use it for prototype evaluation
and reassess the approved production transcription model before public launch.

### Speech authentication

For keyless authentication:

1. Open the Speech resource.
2. Open **Access control (IAM)**.
3. Assign **Cognitive Services User** to your developer identity.
4. Ensure the Speech resource has a custom subdomain.
5. Continue using the same `az login` session.

For temporary key authentication, copy a Speech resource key.

### Configure `.env`

Keyless:

```env
SPEECH_PROVIDER=azure
AZURE_SPEECH_ENDPOINT=https://<speech-resource>.cognitiveservices.azure.com
AZURE_SPEECH_KEY=
AZURE_SPEECH_MODEL=MAI-Transcribe-2
AZURE_SPEECH_TIMEOUT_MS=45000
FFMPEG_PATH=ffmpeg
```

Using a temporary key:

```env
AZURE_SPEECH_KEY=<speech-resource-key>
```

The service converts WhatsApp-style OGG/Opus and other supported inputs to a
16-kHz mono WAV file with local FFmpeg before transcription.

### Test real audio

1. Restart `npm start`.
2. Open **Voice fixture** in Postman.
3. Select a real WAV, MP3, OGG, M4A, AAC, AMR, FLAC, or WebM recording.
4. Ensure the `audio` form-data content type matches the file.
5. Send the request.

The response should contain:

```json
{
  "status": "answered",
  "transcript": {
    "text": "..."
  }
}
```

## 6. Configure cost and quota controls

For the prototype resource group:

1. Open **Cost Management**.
2. Create a monthly budget appropriate for the demo.
3. Add notifications at 50%, 80%, and 100%.
4. Review the model deployment's token-per-minute quota.
5. Start with low capacity and increase it only after observing throttling.
6. Review cost after the first live 150-case evaluation.

## 7. Common problems

### Service will not start

Check:

- `.env` exists.
- `TEST_API_TOKEN` is set when test endpoints are enabled.
- `CONTACT_HASH_KEY` is at least 16 characters.
- The manual path is correct.
- Test endpoints are not enabled with `NODE_ENV=production`.

### Postman returns 401

The Postman `testToken` must exactly match `.env`:

```env
TEST_API_TOKEN=...
```

### Azure returns 401 or 403

- Run `az login` again.
- Select the correct subscription.
- Confirm **Cognitive Services User** is assigned on the Foundry resource.
- Wait several minutes after a new role assignment.
- Confirm the account is in the correct Microsoft Entra tenant.

Owner or Contributor permissions alone do not necessarily grant inference access.

### Azure returns 404

- Use the Foundry **project endpoint** without adding `/openai/v1`.
- Confirm `AZURE_LLM_DEPLOYMENT` is the deployment name, not just the catalog model
  name.
- Confirm deployment status is **Succeeded**.

### Voice request returns 422

- Confirm `SPEECH_PROVIDER=azure` for real audio.
- Confirm the Speech endpoint and authentication.
- Confirm FFmpeg is on `PATH` or set `FFMPEG_PATH`.
- Verify the file content type in Postman.
- Try a short, clear recording first.

## 8. Azure values engineering needs

Provide these non-secret values:

```text
AZURE_FOUNDRY_PROJECT_ENDPOINT
AZURE_LLM_DEPLOYMENT
AZURE_SPEECH_ENDPOINT
AZURE_SPEECH_MODEL
Azure subscription and tenant identifiers
```

Grant the developer or hosted managed identity the required roles instead of sharing
keys where possible. If temporary keys are used, place them directly in the approved
secret store or local `.env`.

## 9. Microsoft documentation

- [Set up Microsoft Foundry resources](https://learn.microsoft.com/en-us/azure/foundry/tutorials/quickstart-create-foundry-resources)
- [Deploy Microsoft Foundry Models](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/how-to/deploy-foundry-models)
- [Configure keyless Microsoft Entra authentication](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/how-to/configure-entra-id)
- [MAI-Transcribe-2](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/mai-transcribe)
- [Fast transcription API](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/fast-transcription-create)
- [Speech resource role-based access control](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/role-based-access-control)
