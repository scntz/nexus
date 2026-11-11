param(
    [ValidateRange(5, 60)][int]$Seconds = 10,
    [ValidateRange(0, 120)][int]$SettleSeconds = 5
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$executablePath = Join-Path $projectRoot 'release/Nexus.exe'
function Get-NexusSnapshot {
    $root = Get-Process -Name Nexus -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $executablePath } | Select-Object -First 1
    if (!$root) { throw 'Open the release/Nexus.exe build before measuring.' }
    $inventory = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId
    $ownedIds = [System.Collections.Generic.HashSet[int]]::new()
    [void]$ownedIds.Add($root.Id)
    do {
        $added = $false
        foreach ($item in $inventory) {
            if ($ownedIds.Contains([int]$item.ParentProcessId) -and $ownedIds.Add([int]$item.ProcessId)) { $added = $true }
        }
    } while ($added)
    @(Get-Process -Id @($ownedIds) -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -in @('Nexus', 'msedgewebview2') } | Select-Object Id, ProcessName, CPU, WorkingSet64, PrivateMemorySize64)
}
# Let startup artwork and discovery finish before sampling.
Start-Sleep -Seconds $SettleSeconds
$before = Get-NexusSnapshot
$timer = [System.Diagnostics.Stopwatch]::StartNew()
Start-Sleep -Seconds $Seconds
$after = Get-NexusSnapshot
$timer.Stop()
$cpuSeconds = 0.0
$processSamples = @()
foreach ($process in $after) {
    $previous = $before | Where-Object { $_.Id -eq $process.Id } | Select-Object -First 1
    $delta = if ($previous) { [Math]::Max([double]0, [double]($process.CPU - $previous.CPU)) } else { 0.0 }
    $cpuSeconds += $delta
    $processSamples += [ordered]@{ name=$process.ProcessName; id=$process.Id; cpuSeconds=[Math]::Round($delta, 4); privateCommittedMiB=[Math]::Round($process.PrivateMemorySize64 / 1MB, 2) }
}
$result = [ordered]@{
    version = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
    timestampUtc = [DateTime]::UtcNow.ToString('o')
    settleSeconds = $SettleSeconds
    intervalSeconds = [Math]::Round($timer.Elapsed.TotalSeconds, 2)
    logicalProcessors = [Environment]::ProcessorCount
    processCountIncludingWebView2 = $after.Count
    cpuPercentOfMachine = [Math]::Round(100 * $cpuSeconds / $timer.Elapsed.TotalSeconds / [Environment]::ProcessorCount, 3)
    summedWorkingSetMiB = [Math]::Round(($after | Measure-Object WorkingSet64 -Sum).Sum / 1MB, 2)
    privateCommittedMiB = [Math]::Round(($after | Measure-Object PrivateMemorySize64 -Sum).Sum / 1MB, 2)
    processes = $processSamples
    note = 'One idle sample, including descendant WebView2 processes. Working-set sums can count shared pages more than once; private commit is not physical RAM. Not a cold-start or controlled benchmark.'
}
$artifactDirectory = Join-Path $projectRoot 'artifacts'
New-Item -ItemType Directory -Force -Path $artifactDirectory | Out-Null
$result | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $artifactDirectory 'idle-benchmark.json') -Encoding utf8
$result | ConvertTo-Json
