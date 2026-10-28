param([string]$InputDocx,[string]$OutputPdf)
$ErrorActionPreference='Stop'
$word=New-Object -ComObject Word.Application
$word.Visible=$false
$word.DisplayAlerts=0
$doc=$null
try {
  $doc=$word.Documents.OpenNoRepairDialog($InputDocx,$false,$false)
  $doc.Repaginate()
  foreach($toc in $doc.TablesOfContents){$toc.Update()}
  $null=$doc.Fields.Update()
  $doc.Repaginate()
  $doc.Save()
  $doc.ExportAsFixedFormat($OutputPdf,17,$false,0,0,1,9999,0,$true,$true,0,$true,$true,$false)
  $pages=$doc.ComputeStatistics(2)
  Write-Output "Saved and rendered $pages pages"
  $doc.Close($false)
  $doc=$null
} finally {
  if($null -ne $doc){$doc.Close($false)}
  $word.Quit()
}
