$ErrorActionPreference = 'Stop'

Write-Host "[Fresh] Installing dependencies"
npm.cmd install

Write-Host "[Fresh] Type checking"
npm.cmd run typecheck

Write-Host "[Fresh] Building desktop app (Windows)"
npm.cmd run build:desktop:win

Write-Host "[Fresh] Done. Output: src-tauri/target/release/bundle/"
