param([switch]$SideBySide, [switch]$PortableOnly)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$version = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
$releaseRoot = Join-Path $projectRoot 'release'
$built = Join-Path $projectRoot 'src-tauri/target/release/nexus.exe'
$builtInstaller = Join-Path $projectRoot "src-tauri/target/release/bundle/nsis/Nexus_$($version)_x64-setup.exe"
if (!(Test-Path -LiteralPath $built) -or (Get-Item -LiteralPath $built).VersionInfo.FileVersion -ne $version) {
    throw 'Build this version with npm run release:build first.'
}
if (!$PortableOnly -and !(Test-Path -LiteralPath $builtInstaller)) {
    throw 'The setup installer has not been built.'
}
$portableDirectory = $releaseRoot
if ($SideBySide) { $portableDirectory = Join-Path $releaseRoot "Nexus-$version" }
New-Item -ItemType Directory -Path $portableDirectory -Force | Out-Null
$portableExecutable = Join-Path $portableDirectory 'Nexus.exe'
if (!(Test-Path -LiteralPath $portableExecutable) -or (Get-FileHash -LiteralPath $built).Hash -ne (Get-FileHash -LiteralPath $portableExecutable).Hash) {
    Copy-Item -LiteralPath $built -Destination $portableExecutable -Force
}
$supportFiles = @(
    @{source='RELEASE_NOTES.md'; name='README.txt'},
    @{source='LICENSE'; name='LICENSE'},
    @{source='LICENSE-MIT'; name='LICENSE-MIT'},
    @{source='LICENSE-APACHE'; name='LICENSE-APACHE'},
    @{source='docs/THIRD_PARTY_LICENSES.txt'; name='THIRD_PARTY_LICENSES.txt'},
    @{source='public/THIRD_PARTY_NOTICES.txt'; name='THIRD_PARTY_NOTICES.txt'},
    @{source='public/art/ATTRIBUTION.md'; name='ARTWORK_SOURCES.md'},
    @{source='public/brands/sources.json'; name='ASSET_SOURCES.json'}
)
$portableFiles = @($portableExecutable)
foreach ($file in $supportFiles) {
    $destination = Join-Path $portableDirectory $file.name
    Copy-Item -LiteralPath (Join-Path $projectRoot $file.source) -Destination $destination -Force
    $portableFiles += $destination
}
$packageFiles = @()
if (!$PortableOnly) {
    $setup = Join-Path $releaseRoot "Nexus-$version-x64-setup.exe"
    Copy-Item -LiteralPath $builtInstaller -Destination $setup -Force
    $packageFiles += $setup
}
& node (Join-Path $PSScriptRoot 'check-release-privacy.mjs') @portableFiles @packageFiles
if ($LASTEXITCODE -ne 0) { throw 'Release payload privacy check failed.' }
$zip = Join-Path $releaseRoot "Nexus-$version-portable.zip"
Compress-Archive -LiteralPath $portableFiles -DestinationPath $zip -Force
$packageFiles += $zip
$packageFiles | Sort-Object | ForEach-Object {
    $hash = Get-FileHash -LiteralPath $_ -Algorithm SHA256
    "$($hash.Hash.ToLowerInvariant())  $([IO.Path]::GetFileName($_))"
} | Set-Content -LiteralPath (Join-Path $releaseRoot 'SHA256SUMS.txt') -Encoding ascii
$packageFiles | Get-Item | Select-Object Name,Length
