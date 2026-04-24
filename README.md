# Fresh

Fresh is a desktop launcher built with React and Tauri 2.

## Prerequisites

- Node.js 20+
- Rust toolchain (for Tauri builds)
- Platform build dependencies required by Tauri:
  https://v2.tauri.app/start/prerequisites/

## Install

```bash
npm install
```

## Development

```bash
# Renderer only
npm run dev

# Full desktop app (Tauri + renderer)
npm run tauri:dev
```

## Build

```bash
# Renderer bundle
npm run build

# Desktop bundle (host platform)
npm run tauri:build

# Platform-targeted bundle shortcuts
npm run build:desktop:linux
npm run build:desktop:win
npm run build:desktop:mac
```
