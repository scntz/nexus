param([ValidateRange(1,5)][int]$Runs = 3)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$executablePath = (Resolve-Path -LiteralPath (Join-Path $projectRoot 'release/Nexus.exe')).Path
$version = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
$diagnosticPath = Join-Path $env:APPDATA 'com.nexus.launcher/diagnostics/startup.json'
$samples = @()
if (Get-Process -Name Nexus -ErrorAction SilentlyContinue) {
    throw 'Close Nexus before running the startup measurement.'
}
for ($runIndex = 0; $runIndex -lt $Runs; $runIndex++) {
    Start-Sleep -Milliseconds 1200
    $startedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $timer = [System.Diagnostics.Stopwatch]::StartNew()
    $process = Start-Process -FilePath $executablePath -WorkingDirectory (Split-Path -Parent $executablePath) -PassThru
    try {
        $sample = $null
        while ($timer.Elapsed.TotalSeconds -lt 30) {
            if ($process.HasExited) { throw 'Nexus exited before reporting a cached-library render.' }
            if (Test-Path -LiteralPath $diagnosticPath) {
                try {
                    $candidate = Get-Content -LiteralPath $diagnosticPath -Raw | ConvertFrom-Json
                    if ($candidate.version -eq $version -and $candidate.timestamp -ge $startedAt) { $sample = $candidate; break }
                } catch { }
            }
            Start-Sleep -Milliseconds 25
        }
        if (!$sample) { throw 'Nexus did not report startup within 30 seconds.' }
        $sample | Add-Member -NotePropertyName observedProcessStartToReportMs -NotePropertyValue ([Math]::Round($timer.Elapsed.TotalMilliseconds,2))
        $samples += $sample
        Write-Output "Run $($runIndex + 1): $([Math]::Round($sample.nativeEntryToCachedLibraryMs,2)) ms to cached library ($($sample.cachedGames) games)"
    } finally {
        if (!$process.HasExited) {
            [void]$process.CloseMainWindow()
            if (!$process.WaitForExit(5000)) {
                Stop-Process -InputObject $process -Force -ErrorAction SilentlyContinue
            }
        }
    }
}
$ordered = @($samples.nativeEntryToCachedLibraryMs | Sort-Object)
$result = [ordered]@{
    version=$version
    timestampUtc=[DateTime]::UtcNow.ToString('o')
    medianNativeEntryToCachedLibraryMs=[Math]::Round($ordered[[Math]::Floor($ordered.Count / 2)],2)
    samples=$samples
    note='Repeated process starts using an existing Windows/WebView2 profile. Not a controlled cold-start benchmark. Native time excludes OS process creation; external observation includes PowerShell launch and polling overhead. Other user processes were left running.'
}
$result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $projectRoot "artifacts/startup-$version.json") -Encoding utf8
