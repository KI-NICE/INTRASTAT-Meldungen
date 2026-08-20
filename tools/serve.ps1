# Lokaler Webserver fuer die Intrastat-App.
# Benoetigt NUR PowerShell (Windows) - kein Node.js, kein Python.
#
# Verwendung:
#   1. Dieses Skript irgendwo ablegen, wo darunter der entpackte App-Ordner
#      liegt (z. B. direkt in "Downloads").
#   2. PowerShell in diesem Ordner oeffnen.
#   3. Ausfuehren:  .\serve.ps1
#      Bei Meldung zur Ausfuehrungsrichtlinie:
#      powershell -ExecutionPolicy Bypass -File .\serve.ps1
#   4. Im Browser oeffnen: http://localhost:8080/
#   5. Beenden mit Strg+C
#
# Das Skript sucht die "index.html" der App automatisch in Unterordnern.
# Alternativ kann der Ordner direkt angegeben werden:
#   .\serve.ps1 -Root "C:\Users\gebhard\Downloads\intrastat-app\dist"

param(
    [int]$Port = 8080,
    [string]$Root = ''
)

$scriptDir = $PSScriptRoot
if (-not $scriptDir) { $scriptDir = (Get-Location).Path }

function Find-AppRoot {
    param([string]$StartDir)

    # 1. index.html direkt im Startordner?
    if (Test-Path (Join-Path $StartDir 'index.html') -PathType Leaf) {
        return $StartDir
    }

    # 2. Sonst rekursiv suchen (node_modules ausgeschlossen), den kuerzesten
    #    Pfad bevorzugen - das ist typischerweise der richtige "dist"-Ordner.
    $candidates = Get-ChildItem -Path $StartDir -Filter 'index.html' -File -Recurse -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -notmatch '\\node_modules\\' } |
        Sort-Object { $_.FullName.Length }

    if ($candidates) {
        # "dist"-Ordner bevorzugen, falls vorhanden
        $preferred = $candidates | Where-Object { $_.DirectoryName -match '\\dist$' } | Select-Object -First 1
        if ($preferred) { return $preferred.DirectoryName }
        return $candidates[0].DirectoryName
    }

    return $null
}

if ($Root) {
    $appRoot = (Resolve-Path -Path $Root -ErrorAction SilentlyContinue).Path
    if (-not $appRoot) {
        Write-Host "Der angegebene Ordner existiert nicht: $Root" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "Suche die App (index.html) unterhalb von: $scriptDir" -ForegroundColor Cyan
    $appRoot = Find-AppRoot -StartDir $scriptDir

    # Liegt das Skript in einem Unterordner (z. B. "tools"), auch eine Ebene
    # darueber suchen.
    if (-not $appRoot) {
        $parent = Split-Path -Parent $scriptDir
        if ($parent) {
            Write-Host "Suche eine Ebene hoeher: $parent" -ForegroundColor Cyan
            $appRoot = Find-AppRoot -StartDir $parent
        }
    }
}

if (-not $appRoot) {
    Write-Host ""
    Write-Host "Es wurde keine 'index.html' gefunden." -ForegroundColor Red
    Write-Host "Bitte entpacken Sie die ZIP-Datei der App in diesen Ordner" -ForegroundColor Yellow
    Write-Host "oder geben Sie den Ordner direkt an, z. B.:" -ForegroundColor Yellow
    Write-Host '  .\serve.ps1 -Root "C:\Pfad\zum\dist"' -ForegroundColor Yellow
    exit 1
}

if (-not (Test-Path (Join-Path $appRoot 'index.html') -PathType Leaf)) {
    Write-Host "Im Ordner '$appRoot' liegt keine index.html." -ForegroundColor Red
    exit 1
}

$mimeTypes = @{
    '.html' = 'text/html; charset=utf-8'
    '.htm'  = 'text/html; charset=utf-8'
    '.js'   = 'text/javascript; charset=utf-8'
    '.mjs'  = 'text/javascript; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.svg'  = 'image/svg+xml'
    '.png'  = 'image/png'
    '.jpg'  = 'image/jpeg'
    '.jpeg' = 'image/jpeg'
    '.gif'  = 'image/gif'
    '.ico'  = 'image/x-icon'
    '.wasm' = 'application/wasm'
    '.woff' = 'font/woff'
    '.woff2' = 'font/woff2'
    '.map'  = 'application/json; charset=utf-8'
    '.traineddata' = 'application/octet-stream'
    '.gz'   = 'application/gzip'
}

$listener = New-Object System.Net.HttpListener
$prefix = "http://localhost:$Port/"
$listener.Prefixes.Add($prefix)

try {
    $listener.Start()
} catch {
    Write-Host "Konnte Port $Port nicht oeffnen (evtl. schon belegt)." -ForegroundColor Red
    Write-Host "Versuchen Sie einen anderen Port, z. B.: .\serve.ps1 -Port 8081" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "App-Ordner : $appRoot" -ForegroundColor Green
Write-Host "Adresse    : $prefix" -ForegroundColor Green
Write-Host "Beenden    : Strg+C"
Write-Host ""

# Browser automatisch oeffnen
try { Start-Process $prefix | Out-Null } catch { }

$rootFull = [System.IO.Path]::GetFullPath($appRoot)

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        try {
            $urlPath = [System.Uri]::UnescapeDataString($request.Url.AbsolutePath)
            if ($urlPath -eq '/') { $urlPath = '/index.html' }

            $candidate = Join-Path $rootFull ($urlPath.TrimStart('/').Replace('/', '\'))
            $resolved = [System.IO.Path]::GetFullPath($candidate)

            # Sicherheits-Check: nicht aus dem App-Ordner herausnavigieren
            if (-not $resolved.StartsWith($rootFull)) {
                $response.StatusCode = 403
                $response.Close()
                continue
            }

            if (-not (Test-Path $resolved -PathType Leaf)) {
                # Fallback fuer Single-Page-App-Routen
                $resolved = Join-Path $rootFull 'index.html'
            }

            $extension = [System.IO.Path]::GetExtension($resolved).ToLowerInvariant()
            $contentType = $mimeTypes[$extension]
            if (-not $contentType) { $contentType = 'application/octet-stream' }

            $bytes = [System.IO.File]::ReadAllBytes($resolved)
            $response.ContentType = $contentType
            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        } catch {
            try { $response.StatusCode = 500 } catch { }
        } finally {
            try { $response.Close() } catch { }
        }
    }
} finally {
    $listener.Stop()
    $listener.Close()
}
