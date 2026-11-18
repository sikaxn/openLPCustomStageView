$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $MyInvocation.MyCommand.Path
$stages = Join-Path $env:APPDATA 'openlp\data\stages'
$views = @('banner-controlled', 'overhead-controlled', 'vmixOverlay-controlled', 'vmixcenter-controlled')

if (-not (Test-Path -LiteralPath $stages -PathType Container)) {
    throw "OpenLP stage folder is missing: $stages"
}

foreach ($view in $views) {
    $source = Join-Path $repo $view
    $destination = Join-Path $stages $view
    Copy-Item -LiteralPath (Join-Path $repo 'controlled-stage.js') -Destination (Join-Path $source 'stage.js') -Force
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    Get-ChildItem -LiteralPath $source -Force | Copy-Item -Destination $destination -Recurse -Force

    foreach ($file in @('stage.js', 'stage.css', 'stage.html', 'config.json')) {
        $expected = (Get-FileHash -LiteralPath (Join-Path $source $file) -Algorithm SHA256).Hash
        $actual = (Get-FileHash -LiteralPath (Join-Path $destination $file) -Algorithm SHA256).Hash
        if ($expected -ne $actual) { throw "Copy verification failed for $view/$file" }
    }
    Write-Output "Deployed $view to $destination"
}
