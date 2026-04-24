#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "[Fresh] Installing dependencies"
npm install

echo "[Fresh] Type checking"
npm run typecheck

echo "[Fresh] Building desktop app (Linux)"
npm run build:desktop:linux

echo "[Fresh] Done. Output: src-tauri/target/release/bundle/"
