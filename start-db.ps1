# [LEGADO — normalmente ya NO hace falta] Levanta el clúster Postgres dedicado
# del proyecto (puerto 5433). Las bases `realshuffle` y `realshuffle_dev` se
# migraron al servidor Postgres siempre-encendido en localhost:5432 (auth trust
# en localhost), así que la app ya no depende de este clúster. Se conserva .pgdata/
# como respaldo; usa este script solo si necesitas volver a arrancar el 5433.
# Este clúster NO es un servicio de Windows, así que hay que arrancarlo
# tras cada reinicio del equipo. Datos en .pgdata/ (ignorado por git).
$ErrorActionPreference = 'Stop'
$bin  = 'C:\Program Files\PostgreSQL\17\bin'
$data = Join-Path $PSScriptRoot '.pgdata'

if (-not (Test-Path (Join-Path $data 'postgresql.conf'))) {
  Write-Error "No existe el clúster en $data. ¿Se inicializó con initdb?"
  exit 1
}

# ¿Ya está aceptando conexiones en 5433?
& "$bin\pg_isready.exe" -h localhost -p 5433 -U realshuffle | Out-Null
if ($LASTEXITCODE -eq 0) {
  Write-Output "Postgres ya está corriendo en localhost:5433."
  exit 0
}

Write-Output "Arrancando Postgres en localhost:5433 ..."
& "$bin\pg_ctl.exe" -D "$data" -l (Join-Path $data 'server.log') -w start
& "$bin\pg_isready.exe" -h localhost -p 5433 -U realshuffle
