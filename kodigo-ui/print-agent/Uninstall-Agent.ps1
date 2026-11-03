$startupFolder = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startupFolder 'Kodigo Print Agent.lnk'
if (Test-Path -LiteralPath $shortcutPath) {
  Remove-Item -LiteralPath $shortcutPath -Force
}
Get-Process -Name 'Kodigo.PrintAgent' -ErrorAction SilentlyContinue | Stop-Process -Force
Write-Output 'Kodigo Print Agent was removed from Windows startup and stopped.'
