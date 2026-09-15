# Azure Container Apps deployment

The deployment uses an Azure Container Registry remote build, so local Docker is not
required.

## Current resource defaults

```text
Subscription: Visual Studio Enterprise Subscription
Resource group: rg-Hackathon
Location: westeurope
Registry: sageregistrya928cd75
Container Apps environment: sage-environment
Container App: sage-support
```

The deployment creates one always-running replica with external HTTPS ingress. SQLite
uses container-local temporary storage, so conversation history is not durable across
revision replacement.

## Deploy

Authenticate to the intended subscription, then run:

```powershell
Set-Location C:\Users\nouromar\source\repos\hackathon\SAGE
az account set --subscription "Visual Studio Enterprise Subscription"
.\deploy\Deploy-Azure.ps1
```

The script creates the Basic registry when necessary, builds the Linux image remotely,
deploys the Bicep template, and prints the health, readiness, and WhatsApp callback
URLs.

To deploy an image that is already in the registry:

```powershell
.\deploy\Deploy-Azure.ps1 `
  -ImageTag "<existing-image-tag>" `
  -SkipBuild
```

## Verify the callback before enabling messaging

Meta callback verification can be enabled before the App Secret, access token, and
phone-number ID are available:

```powershell
$env:WHATSAPP_VERIFY_TOKEN = Read-Host "WhatsApp verification token"
.\deploy\Deploy-Azure.ps1
```

This enables the callback challenge route while keeping inbound message processing and
outbound responses disabled. Do not subscribe the `messages` field until the remaining
Meta credentials have been configured and the deployment has been run with
`-EnableWhatsApp`.

## Enable WhatsApp

Copy the gitignored local environment template and enter the values without placing
them in source control or shell history:

```powershell
Copy-Item deploy\.azure.local.env.example deploy\.azure.local.env
notepad deploy\.azure.local.env

.\deploy\Deploy-Azure.ps1 `
  -EnableWhatsApp `
  -ImageTag "<existing-image-tag>" `
  -SkipBuild
```

Register the callback URL printed by the deployment:

```text
https://<container-app-host>/webhooks/whatsapp
```

Use the exact `WHATSAPP_VERIFY_TOKEN` value when Meta verifies the callback.

## Monitor WhatsApp

After deploying with `-EnableWhatsApp`, use the protected diagnostics monitor to
observe aggregate traffic and delivery outcomes without exposing phone numbers or
message content:

```powershell
.\deploy\Monitor-WhatsApp.ps1
```

The monitor reads `STAFF_API_TOKEN` from the gitignored
`deploy\.azure.local.env` file. Stop it with `Ctrl+C`.

## Azure AI authentication

The Container App has a system-assigned managed identity. Grant that identity
`Cognitive Services User` on the configured Azure AI resource. The application then
uses `DefaultAzureCredential` without storing an Azure model key in Container Apps.

## Real WhatsApp voice notes

Enable Azure Speech transcription when deploying:

```powershell
.\deploy\Deploy-Azure.ps1 -EnableWhatsApp -EnableSpeech
```

The deployment uses the configured Azure AI Speech endpoint and fast
transcription with English (`en-US`) and Kiswahili (`sw-KE`) candidate locales.
It grants the Container App managed identity `Cognitive Services User` access
to the Speech resource, so no Speech key is stored in Container Apps. Without
`-EnableSpeech`, real audio receives the transcription-failure fallback.
