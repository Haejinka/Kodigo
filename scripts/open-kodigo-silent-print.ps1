$bravePath = "C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe"
$appUrl = "http://localhost:5173/"

if (-not (Test-Path -LiteralPath $bravePath)) {
  Write-Error "Brave was not found at $bravePath"
  exit 1
}

$runningBrave = Get-Process brave -ErrorAction SilentlyContinue
if ($runningBrave) {
  Write-Host "Close all Brave windows first, then run this script again."
  Write-Host "Brave only applies --kiosk-printing when it starts fresh."
  exit 2
}

Start-Process -FilePath $bravePath -ArgumentList @(
  "--kiosk-printing",
  "--app=$appUrl"
)
