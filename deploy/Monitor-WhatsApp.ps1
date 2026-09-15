[CmdletBinding()]
param(
  [string] $BaseUrl = "https://sage-support.delightfulglacier-4095fdf8.westeurope.azurecontainerapps.io",
  [int] $IntervalSeconds = 5
)

$ErrorActionPreference = "Stop"
$localEnvironmentFile = Join-Path $PSScriptRoot ".azure.local.env"

if (-not (Test-Path $localEnvironmentFile)) {
  throw "Missing $localEnvironmentFile."
}

$staffApiToken = $null
foreach ($line in Get-Content $localEnvironmentFile) {
  $separator = $line.IndexOf("=")
  if ($separator -gt 0 -and $line.Substring(0, $separator) -eq "STAFF_API_TOKEN") {
    $staffApiToken = $line.Substring($separator + 1).Trim()
    break
  }
}

if (-not $staffApiToken) {
  throw "STAFF_API_TOKEN is not configured."
}

$headers = @{ Authorization = "Bearer $staffApiToken" }
$endpoint = "$($BaseUrl.TrimEnd('/'))/api/staff/diagnostics"

while ($true) {
  try {
    $snapshot = Invoke-RestMethod `
      -Method Get `
      -Uri $endpoint `
      -Headers $headers `
      -TimeoutSec 30

    [pscustomobject]@{
      Time = Get-Date -Format "HH:mm:ss"
      LatestActivity = $snapshot.latestActivityAt
      Inbound = $snapshot.messages.inbound
      Outbound = $snapshot.messages.outbound
      AnswersSent = $snapshot.deliveries.sent
      DeliveryFailures = $snapshot.deliveries.failed
      WaitingHandoffs = $snapshot.handoffs.waiting
      AudioFailures = $snapshot.auditEvents.whatsapp_audio_failure
      ProcessingFailures = $snapshot.auditEvents.whatsapp_processing_failure
    } | Format-Table -AutoSize
  } catch {
    Write-Warning "Diagnostics request failed: $($_.Exception.Message)"
  }

  Start-Sleep -Seconds $IntervalSeconds
}
