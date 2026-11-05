param(
  [Parameter(Mandatory = $true)][string]$RepositoryRoot,
  [Parameter(Mandatory = $true)][string]$DatabasePath,
  [Parameter(Mandatory = $true)][string]$ResultsPath
)
$ErrorActionPreference = 'Stop'
$resolvedRepository = (Resolve-Path -LiteralPath $RepositoryRoot).Path
$resolvedDatabase = (Resolve-Path -LiteralPath $DatabasePath).Path
$runnerPath = Join-Path $resolvedRepository 'packages/evaluation/validation/run.mjs'
if (-not (Test-Path -LiteralPath $runnerPath)) { throw 'The repository does not contain the evidence runner.' }

# Copied review bundles execute canonical sources with workspace dependencies.
# Hashes prevent silently executing a different test revision than the bundle.
$manifestPath = Join-Path $PSScriptRoot 'SOURCE-MANIFEST.json'
if (Test-Path -LiteralPath $manifestPath) {
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  foreach ($entry in $manifest.PSObject.Properties) {
    $sourceFile = Join-Path $resolvedRepository $entry.Name
    $actualHash = (Get-FileHash -LiteralPath $sourceFile -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $entry.Value) { throw "Source revision differs from the review bundle: $($entry.Name)" }
  }
}
Push-Location -LiteralPath $resolvedRepository
try {
  & node $runnerPath --db $resolvedDatabase --out $ResultsPath
  if ($LASTEXITCODE -ne 0) { throw "Validation failed with exit code $LASTEXITCODE. Inspect results.json and the test log." }
} finally { Pop-Location }
