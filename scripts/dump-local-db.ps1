# Vuelca la BD local (realshuffle en localhost:5433) a un archivo comprimido para
# restaurarla en el VPS. Así tus cuentas conectadas (cookie de YouTube, tokens de
# Spotify), tus listas y tus estadísticas viajan contigo y no reconectas nada.
#
# Uso:   .\scripts\dump-local-db.ps1
# Luego: scp realshuffle.dump usuario@tu-vps:~/  (y ver docs/DEPLOY.md para el restore)
$ErrorActionPreference = 'Stop'
$bin = 'C:\Program Files\PostgreSQL\17\bin'
$out = Join-Path (Get-Location) 'realshuffle.dump'

& "$bin\pg_dump.exe" -h localhost -p 5433 -U realshuffle -d realshuffle -Fc -f $out
$mb = '{0:N1}' -f ((Get-Item $out).Length / 1MB)
Write-Output "OK -> $out  ($mb MB)"
Write-Output "Ahora: scp `"$out`" usuario@TU_VPS:~/   y sigue docs/DEPLOY.md (Paso 5)."
