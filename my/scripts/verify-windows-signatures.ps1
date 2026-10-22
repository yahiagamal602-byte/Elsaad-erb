param(
  [Parameter(Mandatory = $true)]
  [string]$ReleaseDirectory
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $ReleaseDirectory -PathType Container)) {
  Write-Error 'The Windows release output directory does not exist.'
  exit 1
}

$releaseRoot = (Resolve-Path -LiteralPath $ReleaseDirectory).Path
$installers = @(Get-ChildItem -LiteralPath $releaseRoot -Filter '*.exe' -File)
$application = Join-Path $releaseRoot 'win-unpacked\Elsaad ERP.exe'

if ($installers.Count -eq 0) {
  Write-Error 'No NSIS installer executable was produced.'
  exit 1
}
if (-not (Test-Path -LiteralPath $application -PathType Leaf)) {
  Write-Error 'The unpacked Elsaad ERP executable was not produced.'
  exit 1
}

$executables = @($installers) + @(
  Get-ChildItem -LiteralPath (Join-Path $releaseRoot 'win-unpacked') -Filter '*.exe' -File -Recurse
)
foreach ($executable in $executables) {
  $signature = Get-AuthenticodeSignature -LiteralPath $executable.FullName
  if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid -or $null -eq $signature.SignerCertificate) {
    Write-Error "Authenticode verification failed for '$($executable.FullName)' (status: $($signature.Status))."
    exit 1
  }
}

Write-Output "Verified Authenticode signatures for $($executables.Count) Windows executable(s)."
