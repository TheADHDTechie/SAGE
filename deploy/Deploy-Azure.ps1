[CmdletBinding()]
param(
  [string] $ResourceGroup = "rg-Hackathon",
  [string] $Location = "westeurope",
  [string] $RegistryName = "sageregistrya928cd75",
  [string] $EnvironmentName = "sage-environment",
  [string] $AppName = "sage-support",
  [string] $AzureOpenAIEndpoint = "https://ai-nour2005-0011.openai.azure.com",
  [string] $AzureLlmDeployment = "gpt-5.6-luna",
  [string] $AzureAiResourceName = "ai-nour2005-0011",
  [string] $AzureSpeechEndpoint = "https://ai-nour20055617ai423721357232.cognitiveservices.azure.com",
  [string] $AzureSpeechResourceName = "ai-nour20055617ai423721357232",
  [string] $ImageTag = (Get-Date -Format "yyyyMMddHHmmss"),
  [switch] $SkipBuild,
  [switch] $EnableWhatsApp,
  [switch] $EnableSpeech
)

$ErrorActionPreference = "Stop"

$localEnvironmentFile = Join-Path $PSScriptRoot ".azure.local.env"
if (Test-Path $localEnvironmentFile) {
  foreach ($line in Get-Content $localEnvironmentFile) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#")) {
      continue
    }

    $separator = $trimmed.IndexOf("=")
    if ($separator -lt 1) {
      throw "Invalid entry in $localEnvironmentFile."
    }

    $name = $trimmed.Substring(0, $separator).Trim()
    $value = $trimmed.Substring($separator + 1).Trim()
    if (-not [Environment]::GetEnvironmentVariable($name)) {
      [Environment]::SetEnvironmentVariable($name, $value)
    }
  }
}

function Assert-AzureCommand {
  param([string] $Action)

  if ($LASTEXITCODE -ne 0) {
    throw "Azure CLI failed while trying to $Action."
  }
}

function Get-DeploymentValue {
  param(
    [Parameter(Mandatory)]
    [string] $Name,
    [switch] $Required
  )

  $value = [Environment]::GetEnvironmentVariable($Name)
  if ($Required -and [string]::IsNullOrWhiteSpace($value)) {
    throw "Set the $Name environment variable before enabling WhatsApp."
  }
  if ([string]::IsNullOrWhiteSpace($value)) {
    return "not-configured-$([guid]::NewGuid().ToString('N'))"
  }
  return $value
}

$contactHashKey = Get-DeploymentValue -Name "SAGE_CONTACT_HASH_KEY"
$whatsAppVerifyToken = Get-DeploymentValue `
  -Name "WHATSAPP_VERIFY_TOKEN" `
  -Required:$EnableWhatsApp
$metaAppSecret = Get-DeploymentValue `
  -Name "META_APP_SECRET" `
  -Required:$EnableWhatsApp
$whatsAppAccessToken = Get-DeploymentValue `
  -Name "WHATSAPP_ACCESS_TOKEN" `
  -Required:$EnableWhatsApp
$whatsAppPhoneNumberId = Get-DeploymentValue `
  -Name "WHATSAPP_PHONE_NUMBER_ID" `
  -Required:$EnableWhatsApp
$staffApiToken = Get-DeploymentValue `
  -Name "STAFF_API_TOKEN" `
  -Required:$EnableWhatsApp

$groupExists = az group exists --name $ResourceGroup --output tsv
Assert-AzureCommand -Action "check the resource group"
if ($groupExists -ne "true") {
  az group create `
    --name $ResourceGroup `
    --location $Location `
    --output none
  Assert-AzureCommand -Action "create the resource group"
}

$registryExists = az acr show `
  --name $RegistryName `
  --resource-group $ResourceGroup `
  --query name `
  --output tsv `
  2>$null

if (-not $registryExists) {
  az acr create `
    --name $RegistryName `
    --resource-group $ResourceGroup `
    --location $Location `
    --sku Basic `
    --admin-enabled true `
    --output none
  Assert-AzureCommand -Action "create the container registry"
}

if (-not $SkipBuild) {
  az acr build `
    --registry $RegistryName `
    --image "sage-support:$ImageTag" `
    --file Dockerfile `
    .
  Assert-AzureCommand -Action "build the container image"
}

$deploymentJson = az deployment group create `
  --name "sage-$ImageTag" `
  --resource-group $ResourceGroup `
  --template-file deploy\azure-container-app.bicep `
  --parameters `
    location=$Location `
    registryName=$RegistryName `
    imageTag=$ImageTag `
    environmentName=$EnvironmentName `
    appName=$AppName `
    azureOpenAIEndpoint=$AzureOpenAIEndpoint `
    azureLlmDeployment=$AzureLlmDeployment `
    speechEnabled=$($EnableSpeech.IsPresent.ToString().ToLowerInvariant()) `
    azureSpeechEndpoint=$AzureSpeechEndpoint `
    contactHashKey=$contactHashKey `
    whatsappEnabled=$($EnableWhatsApp.IsPresent.ToString().ToLowerInvariant()) `
    whatsappVerifyToken=$whatsAppVerifyToken `
    metaAppSecret=$metaAppSecret `
    whatsappAccessToken=$whatsAppAccessToken `
    whatsappPhoneNumberId=$whatsAppPhoneNumberId `
    staffApiToken=$staffApiToken `
  --query properties.outputs `
  --output json
Assert-AzureCommand -Action "deploy the Container App"
$deployment = $deploymentJson | ConvertFrom-Json

$principalId = $deployment.appPrincipalId.value
$aiResourceId = az cognitiveservices account show `
  --name $AzureAiResourceName `
  --resource-group $ResourceGroup `
  --query id `
  --output tsv
Assert-AzureCommand -Action "find the Azure AI resource"

$existingRole = az role assignment list `
  --assignee $principalId `
  --scope $aiResourceId `
  --query "[?roleDefinitionName=='Cognitive Services User'].id | [0]" `
  --output tsv
Assert-AzureCommand -Action "check Azure AI access"

if (-not $existingRole) {
  az role assignment create `
    --assignee-object-id $principalId `
    --assignee-principal-type ServicePrincipal `
    --role "Cognitive Services User" `
    --scope $aiResourceId `
    --output none
  Assert-AzureCommand -Action "grant Azure AI access"
}

if ($EnableSpeech) {
  $speechResourceId = az cognitiveservices account show `
    --name $AzureSpeechResourceName `
    --resource-group $ResourceGroup `
    --query id `
    --output tsv
  Assert-AzureCommand -Action "find the Azure Speech resource"

  $existingSpeechRole = az role assignment list `
    --assignee $principalId `
    --scope $speechResourceId `
    --query "[?roleDefinitionName=='Cognitive Services User'].id | [0]" `
    --output tsv
  Assert-AzureCommand -Action "check Azure Speech access"

  if (-not $existingSpeechRole) {
    az role assignment create `
      --assignee-object-id $principalId `
      --assignee-principal-type ServicePrincipal `
      --role "Cognitive Services User" `
      --scope $speechResourceId `
      --output none
    Assert-AzureCommand -Action "grant Azure Speech access"
  }
}

$deployment | ConvertTo-Json -Depth 10
