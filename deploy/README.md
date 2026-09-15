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

Set the Meta values only in the current PowerShell process. Do not save them in source
control or shell history.

```powershell
$env:SAGE_CONTACT_HASH_KEY = Read-Host "Stable contact hash key"
$env:WHATSAPP_VERIFY_TOKEN = Read-Host "WhatsApp verification token"
$env:META_APP_SECRET = Read-Host "Meta app secret"
$env:WHATSAPP_ACCESS_TOKEN = Read-Host "WhatsApp access token"
$env:WHATSAPP_PHONE_NUMBER_ID = Read-Host "WhatsApp phone number ID"
$env:STAFF_API_TOKEN = Read-Host "Staff API token"

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

Clear the current PowerShell values afterward:

```powershell
Remove-Item Env:SAGE_CONTACT_HASH_KEY
Remove-Item Env:WHATSAPP_VERIFY_TOKEN
Remove-Item Env:META_APP_SECRET
Remove-Item Env:WHATSAPP_ACCESS_TOKEN
Remove-Item Env:WHATSAPP_PHONE_NUMBER_ID
Remove-Item Env:STAFF_API_TOKEN
```

## Azure AI authentication

The Container App has a system-assigned managed identity. Grant that identity
`Cognitive Services User` on the configured Azure AI resource. The application then
uses `DefaultAzureCredential` without storing an Azure model key in Container Apps.

## Real WhatsApp voice notes

The initial deployment uses `SPEECH_PROVIDER=mock`. Configure an Azure Speech endpoint
and update the Bicep environment settings before testing real WhatsApp audio. With the
mock provider, real audio receives the transcription-failure fallback.
