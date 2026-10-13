param([Parameter(Mandatory=$true)][string]$ImagePath, [switch]$OpenImage)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try {
    $psApp = [Runtime.InteropServices.Marshal]::GetActiveObject('Photoshop.Application')
    $quotedPath = ConvertTo-Json -InputObject $ImagePath -Compress
    $openRequested = if ($OpenImage) { 'true' } else { 'false' }
    $script = @"
(function () {
    if ($openRequested || !app.documents.length) { app.open(new File($quotedPath)); return 'OPENED'; }
    var descriptor = new ActionDescriptor();
    descriptor.putPath(charIDToTypeID('null'), new File($quotedPath));
    descriptor.putBoolean(stringIDToTypeID('linked'), false);
    descriptor.putEnumerated(charIDToTypeID('FTcs'), charIDToTypeID('QCSt'), charIDToTypeID('Qcsa'));
    executeAction(charIDToTypeID('Plc '), descriptor, DialogModes.NO);
    app.activeDocument.activeLayer.name = '网页图片';
    return 'PLACED';
})();
"@
    $result = $psApp.DoJavaScript($script)
    if ($result -ne 'PLACED' -and $result -ne 'OPENED') { throw 'Photoshop 未返回置入成功标记' }
    # Focus only after a confirmed successful open/place operation.
    try {
        $psApp.DoJavaScript('app.bringToFront();') | Out-Null
        $psWindow = Get-Process -Name Photoshop -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
        if ($psWindow) {
            $shell = New-Object -ComObject WScript.Shell
            $shell.AppActivate([int]$psWindow.Id) | Out-Null
        }
    } catch {
        # A foreground restriction must not turn successful placement into failure.
        [Console]::Error.WriteLine('Photoshop foreground activation: ' + $_.Exception.Message)
    }
    Write-Output $result
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
