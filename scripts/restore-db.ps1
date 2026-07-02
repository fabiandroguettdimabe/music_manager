# Restaura la BD de Real Shuffle Player en OTRO equipo desde un dump (.dump)
# generado por scripts/dump-local-db.ps1. Crea el rol y la base si faltan y
# restaura los datos (cuentas conectadas, playlists, estadísticas).
#
# ── Requisitos en el equipo DESTINO ─────────────────────────────────────────
#  - PostgreSQL 17 instalado (ajusta -PgBin si usas otra versión/ruta).
#  - El servidor escuchando (por defecto localhost:5432).
#  - Autenticación al crear rol/base: el script se conecta como superusuario
#    ($SuperUser, por defecto 'postgres'). Si tu servidor pide contraseña,
#    define antes:  $env:PGPASSWORD = 'tu-clave-postgres'   (o configura trust).
#  - IMPORTANTE: copia también backend-node/.env (NO está en git) con el MISMO
#    CREDENTIALS_ENC_KEY del equipo origen; si no, las cookies/tokens guardados
#    en la BD no se podrán descifrar y tendrás que reconectar las cuentas.
#
# ── Uso ─────────────────────────────────────────────────────────────────────
#   .\scripts\restore-db.ps1
#   .\scripts\restore-db.ps1 -DumpFile C:\ruta\realshuffle.dump -DbName realshuffle -Port 5432
param(
  [string]$DumpFile  = 'realshuffle.dump',
  [string]$DbName    = 'realshuffle',
  [int]   $Port      = 5432,
  [string]$SuperUser = 'postgres',    # superusuario que crea rol/base y restaura
  [string]$AppRole   = 'realshuffle', # rol dueño de la base (el que usa la app)
  [string]$PgBin     = 'C:\Program Files\PostgreSQL\17\bin'
)
$ErrorActionPreference = 'Stop'

$psql       = Join-Path $PgBin 'psql.exe'
$pg_restore = Join-Path $PgBin 'pg_restore.exe'
if (-not (Test-Path $DumpFile)) { throw "No existe el dump: $DumpFile. Genera uno en el equipo origen con scripts/dump-local-db.ps1." }
if (-not (Test-Path $psql))     { throw "No encuentro psql en $PgBin. Instala PostgreSQL 17 o ajusta -PgBin." }

Write-Host "== Restaurando '$DbName' en localhost:$Port desde $DumpFile ==" -ForegroundColor Cyan

# 1) Rol de la app (idempotente: solo se crea si falta).
$roleExists = & $psql -h localhost -p $Port -U $SuperUser -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='$AppRole';"
if (-not $roleExists) {
  & $psql -h localhost -p $Port -U $SuperUser -d postgres -v ON_ERROR_STOP=1 -c "CREATE ROLE $AppRole WITH LOGIN CREATEDB;"
  Write-Host "  Rol '$AppRole' creado." -ForegroundColor Green
} else {
  Write-Host "  Rol '$AppRole' ya existe." -ForegroundColor DarkGray
}

# 2) Base de datos (si no existe) propiedad del rol de la app.
$dbExists = & $psql -h localhost -p $Port -U $SuperUser -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DbName';"
if (-not $dbExists) {
  & $psql -h localhost -p $Port -U $SuperUser -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $DbName OWNER $AppRole;"
  Write-Host "  Base '$DbName' creada." -ForegroundColor Green
} else {
  Write-Host "  Base '$DbName' ya existe; se restaura encima (--clean --if-exists)." -ForegroundColor Yellow
}

# 3) Restaurar el dump (los objetos quedan a nombre de '$AppRole', que ya existe).
& $pg_restore -h localhost -p $Port -U $SuperUser -d $DbName --clean --if-exists --no-privileges $DumpFile
if ($LASTEXITCODE -ne 0) { Write-Warning "pg_restore devolvió $LASTEXITCODE (algunos avisos son normales). Revisa la salida." }

Write-Host ""
Write-Host "OK: '$DbName' restaurada en localhost:$Port." -ForegroundColor Green
Write-Host "Siguiente: copia backend-node/.env (mismo CREDENTIALS_ENC_KEY) y arranca la app." -ForegroundColor DarkGray
Write-Host "Si el esquema cambió: en backend-node ejecuta  npx prisma migrate deploy" -ForegroundColor DarkGray
