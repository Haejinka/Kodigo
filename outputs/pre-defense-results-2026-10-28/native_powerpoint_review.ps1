param([string]$InputPptx,[string]$OutputDirectory)
$ErrorActionPreference='Stop'
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$app=New-Object -ComObject PowerPoint.Application
$existing=$app.Presentations.Count
$deck=$null
try {
 $deck=$app.Presentations.Open($InputPptx,-1,0,0)
 $charts=@()
 for($i=1;$i -le $deck.Slides.Count;$i++){
  $slide=$deck.Slides.Item($i)
  $slide.Export((Join-Path $OutputDirectory ('slide-{0:D2}.png' -f $i)),'PNG',1920,1080)
  foreach($shape in $slide.Shapes){
   if($shape.HasChart -eq -1){
    $series=$shape.Chart.SeriesCollection(1)
    $charts+=@{slide=$i;values=@($series.Values);categories=@($series.XValues);linked=$shape.Chart.ChartData.IsLinked}
   }
  }
 }
 @{slideCount=$deck.Slides.Count;nativeCharts=$charts;openedReadOnly=$true;existingPresentations=$existing}|ConvertTo-Json -Depth 8|Set-Content -LiteralPath (Join-Path $OutputDirectory 'native-application-check.json') -Encoding utf8
 Write-Output ('PowerPoint opened {0} slides and {1} editable charts' -f $deck.Slides.Count,$charts.Count)
 $deck.Close();$deck=$null
} finally {
 if($null -ne $deck){$deck.Close()}
 if($existing -eq 0){$app.Quit()}
}
