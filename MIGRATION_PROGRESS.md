# Fresh Migration Progress

Date: 2026-04-23  
Status: Mostly complete (core migration implemented and build/runtime verified; remaining items are parity hardening/manual QA)

## Completed So Far

1. Project migration setup
- Copied `FunkHub` source into `Fresh` without modifying the original repo.
- Added migration planning document: `MIGRATION_PLAN.md`.

2. Tauri 2 conversion baseline
- Added `src-tauri/` project with:
  - `Cargo.toml`
  - `build.rs`
  - `src/main.rs`
  - `src/lib.rs`
  - `tauri.conf.json`
  - `capabilities/default.json`
- Added Tauri plugins/dependencies and scripts in `package.json`.

3. Frontend bridge migration
- Added Tauri desktop bridge:
  - `src/desktop/bridge.ts`
  - `src/desktop/init.ts`
- Bootstrapped bridge in `main.tsx`.
- Kept existing frontend service contract via `window.funkhubDesktop`.
- Updated build constants to `__FRESH_VERSION__` and `__FRESH_CHANNEL__`.

4. Core backend command migration (Rust)
- Implemented Rust commands used by frontend for:
  - install/download/extract/cancel flow
  - launch/get-running/kill
  - open path/open url/delete/inspect/list
  - import engine/import mod
  - settings get/update
  - deep-link pending queue + event emit
  - engine inspection
  - basic update/itch fallback responses where full parity is not yet finished

5. Branding and runtime cleanup
- Renamed package metadata to `Fresh`.
- Updated deep-link handling to support `fresh://` while keeping `funkhub://` backward compatibility.
- Removed `electron/` runtime folder from `Fresh`.
- Updated build/test scripts to Tauri flow.

6. Fixes and checks already run
- `npm install`: passed.
- `npm run typecheck`: passed (after fixing `ModDetailsPage.tsx` union access errors).
- `npm run build`: passed.
- `cargo check` in `src-tauri`: passed.
- `npm run dev`: verified.
- `npm run tauri:dev`: verified app starts and Fresh window opens.
- `npm run tauri:build`: verified; produced MSI + NSIS bundles.
- `npm test`: passed (Vitest).
- `cargo test`: passed (0 tests defined).

## What Is Missing

1. Full feature parity gaps
- Itch OAuth desktop flow is currently a structured fallback response, not fully ported.
- In-app updater command parity is partially delegated to frontend plugin flow and not fully mirrored in Rust command behavior.
- Archive extraction parity for `.rar` currently depends on external `7z` availability.

2. Verification gaps from interrupted run
- `npm run tauri:build` was interrupted by user during elevated execution, so final production bundle verification is incomplete.
- End-to-end manual workflow validation still pending:
  - download + progress + cancel/retry
  - extraction edge-cases (nested archives/rar)
  - install placement checks
  - executable launch behavior across all launcher modes
  - deep-link startup flow from OS protocol invocation

3. Hardening still needed
- Tighten/validate capabilities against final used plugin permissions.
- Expand path-safety checks further for all import/open/delete edge cases.
- Optional: add richer error codes beyond current string errors in Rust responses.

## Current Known Environment Blockers

1. Sandboxed process spawning causes `spawn EPERM` for Vite/esbuild unless command is run elevated.
2. Long-running `tauri:build` was manually interrupted before completion.

## Recommended Next Execution Steps

1. Run:
```powershell
npm.cmd run tauri:build
```
and wait for completion.

2. Run:
```powershell
npm.cmd run tauri:dev
```
then perform manual workflow QA in-app.

3. Complete parity work items:
- implement full itch OAuth Rust flow
- finalize updater parity semantics in Rust/backend events
- validate rar extraction strategy for Windows target packaging
