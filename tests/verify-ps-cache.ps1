$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$root = Join-Path $PSScriptRoot 'cache-verification'
$ps = [Runtime.InteropServices.Marshal]::GetActiveObject('Photoshop.Application')
$placeScript = Join-Path $PSScriptRoot '..\apps\mcp-server\dist\photoshop-place.ps1'
$embedded = Join-Path $root 'embedded-source.png'
$opened = Join-Path $root 'opened-source.png'
$target = Join-Path $root 'embedded-after-delete.psd'
$openedTarget = Join-Path $root 'opened-after-delete.psd'
$qTarget = ConvertTo-Json $target -Compress
$qOpenedTarget = ConvertTo-Json $openedTarget -Compress
$originalId = $ps.DoJavaScript('app.documents.length ? String(app.activeDocument.id) : "";')
$owned = [Collections.Generic.List[string]]::new()
try {
 $id = $ps.DoJavaScript('var d=app.documents.add(64,64,72,"Codex cache verification"); String(d.id);'); $owned.Add($id)
 & $placeScript -ImagePath $embedded
 Remove-Item -LiteralPath $embedded
 $ps.DoJavaScript("var o=new PhotoshopSaveOptions(); app.activeDocument.saveAs(new File($qTarget),o,true); app.activeDocument.close(SaveOptions.DONOTSAVECHANGES); var d=app.open(new File($qTarget)); if(d.activeLayer.kind!==LayerKind.SMARTOBJECT) throw new Error('Not a Smart Object'); String(d.id);") | ForEach-Object { $owned.Add($_) }
 $ps.DoJavaScript('app.activeDocument.close(SaveOptions.DONOTSAVECHANGES);') | Out-Null
 & $placeScript -ImagePath $opened -OpenImage
 $owned.Add($ps.DoJavaScript('String(app.activeDocument.id);'))
 Remove-Item -LiteralPath $opened
 $ps.DoJavaScript("var o=new PhotoshopSaveOptions(); app.activeDocument.saveAs(new File($qOpenedTarget),o,true); app.activeDocument.close(SaveOptions.DONOTSAVECHANGES); var d=app.open(new File($qOpenedTarget)); String(d.id);") | ForEach-Object { $owned.Add($_) }
 Write-Output 'PASS: embedded Smart Object and opened image save/reopen after deleting download source'
} finally {
 foreach ($id in $owned) { $ps.DoJavaScript("for(var i=app.documents.length-1;i>=0;i--){if(app.documents[i].id===$id) app.documents[i].close(SaveOptions.DONOTSAVECHANGES);}") | Out-Null }
 if ($originalId) { $ps.DoJavaScript("for(var i=0;i<app.documents.length;i++){if(app.documents[i].id===$originalId) app.activeDocument=app.documents[i];}") | Out-Null }
}
