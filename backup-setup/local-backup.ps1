# Isheeka ERP — local nightly backup (Option B)
# Saves a compressed pg_dump of the public schema to C:\Users\<you>\IsheekaBackups
# and prunes anything older than 90 days. Requires PostgreSQL client tools (pg_dump)
# on PATH and a SUPABASE_DB_URL environment variable (the Session-pooler URI).

$ErrorActionPreference = 'Stop'

$DbUrl = $env:SUPABASE_DB_URL
if (-not $DbUrl) { Write-Error "Set the SUPABASE_DB_URL environment variable first (the Session-pooler connection string from Supabase)."; exit 1 }

$Dir = Join-Path $HOME 'IsheekaBackups'
New-Item -ItemType Directory -Force -Path $Dir | Out-Null

$stamp = Get-Date -Format 'yyyy-MM-dd_HHmm'
$out   = Join-Path $Dir "isheeka-$stamp.dump"

Write-Host "Backing up to $out ..."
pg_dump --no-owner --no-privileges --schema=public -Fc -f $out $DbUrl
if ($LASTEXITCODE -ne 0) { Write-Error "pg_dump failed."; exit 1 }

# Optional: also copy the latest to OneDrive (uncomment + adjust if you sync to cloud)
# $cloud = Join-Path $env:OneDrive 'IsheekaBackups'
# New-Item -ItemType Directory -Force -Path $cloud | Out-Null
# Copy-Item $out $cloud -Force

# Prune local copies older than 90 days
Get-ChildItem $Dir -Filter 'isheeka-*.dump' |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-90) } |
  Remove-Item -Force

Write-Host "Done. Files in $Dir :"
Get-ChildItem $Dir -Filter 'isheeka-*.dump' | Sort-Object LastWriteTime -Descending | Select-Object -First 5 Name,Length,LastWriteTime
