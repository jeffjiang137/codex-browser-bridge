try {
 $psProbe = [Runtime.InteropServices.Marshal]::GetActiveObject('Photoshop.Application')
 Write-Output ('COM_CONNECTED documents=' + $psProbe.Documents.Count)
} catch { Write-Output ('COM_PROBE_FAILED ' + $_.Exception.Message); exit 1 }
