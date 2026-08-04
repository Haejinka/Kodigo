param(
    [Parameter(Mandatory = $true)][string]$InputDocx,
    [Parameter(Mandatory = $true)][string]$OutputPdf
)

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
$word.Options.SaveInterval = 0
try {
    $doc = $word.Documents.OpenNoRepairDialog($InputDocx, $false, $true)
    $doc.ExportAsFixedFormat($OutputPdf, 17, $false, 0, 0, 1, 9999, 0, $true, $true, 0, $true, $true, $false)
    $doc.Close($false)
}
finally {
    $word.Quit()
}
