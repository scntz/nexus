param([switch]$PortableOnly)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$previousEncodedFlags = $env:CARGO_ENCODED_RUSTFLAGS
$previousFlags = $env:RUSTFLAGS
$separator = [string][char]31
$flags = @()
if ($previousEncodedFlags) {
    $flags += $previousEncodedFlags.Split([char]31)
} elseif ($previousFlags) {
    $flags += $previousFlags -split '\s+'
}
$sysroot = (& rustc --print sysroot).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Rust is required to build a release.' }
$mappings = @(
    @{ source = [Environment]::GetFolderPath('UserProfile'); target = '/user' },
    @{ source = $projectRoot; target = '/nexus' },
    @{ source = $sysroot; target = '/rust' }
)
foreach ($mapping in $mappings) {
    if (!$mapping.source) { continue }
    foreach ($prefix in @($mapping.source, $mapping.source.Replace('\', '/'), ('\\?\' + $mapping.source))) {
        $flags += "--remap-path-prefix=$prefix=$($mapping.target)"
    }
}
try {
    $env:RUSTFLAGS = $null
    $env:CARGO_ENCODED_RUSTFLAGS = $flags -join $separator
    Push-Location -LiteralPath $projectRoot
    try {
        & npm.cmd run desktop:build -- --no-bundle
        if ($LASTEXITCODE -ne 0) { throw 'The Windows release build failed.' }
        if (!$PortableOnly) {
            & npx.cmd tauri bundle --bundles nsis --config (Join-Path $projectRoot 'src-tauri/release.bundle.json')
            if ($LASTEXITCODE -ne 0) { throw 'The Windows installer bundle failed.' }
        }
    } finally {
        Pop-Location
    }
} finally {
    $env:CARGO_ENCODED_RUSTFLAGS = $previousEncodedFlags
    $env:RUSTFLAGS = $previousFlags
}
