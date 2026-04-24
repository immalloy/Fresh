# Fresh Migration Plan (Electron -> Tauri 2)

Status: Planning only.  
Date: April 23, 2026  
Source app (read-only): `C:\Users\Henry\Documents\GitHub\FunkHub`  
Target app: `C:\Users\Henry\Documents\GitHub\Fresh`  
Final app branding: `Fresh`

## Constraints
1. Do not modify `FunkHub`.
2. Use Tauri 2 (not Tauri 1).
3. Remove Electron as a runtime dependency in final state.
4. Prioritize Windows support without blocking Linux/macOS later.
5. Preserve core functionality and UX parity where possible.

## 1) High-Level Migration Strategy
1. Build `Fresh` as a clean Tauri 2 desktop app using `FunkHub` as behavior baseline.
2. Reuse React/Vite frontend with minimal UX deltas.
3. Replace Electron preload/IPC surface with Tauri bridge (`invoke`, plugins, events).
4. Move Node/Electron runtime logic (download/extract/install/launch/fs/update/deeplink) into Rust commands/modules.
5. Achieve parity first, then do cleanup/hardening and full QA.

## 2) Subagent Responsibilities
1. Project Audit Subagent: baseline architecture, IPC inventory, migration risks.
2. Tauri Architecture Subagent: Tauri 2 structure, permissions, plugin selection, security design.
3. Frontend Migration Subagent: UI/component migration and Electron API replacement plan.
4. Rust Backend Subagent: command set, module boundaries, error/progress/event model.
5. Build & Cleanup Subagent: package/config/dependency/script migration and cleanup sequence.
6. QA Subagent: parity checklist, matrix, risk workflows, success criteria.

## 3) Electron-to-Tauri Feature Mapping
| Electron Feature | Tauri 2 Target |
|---|---|
| `electron/main.cjs` app/window lifecycle | `src-tauri/src/main.rs` + `tauri.conf.json` |
| Preload `ipcRenderer.invoke` bridge | TS `desktopBridge` using `@tauri-apps/api/core` `invoke` |
| IPC events (`install-progress`, `app-update`, `launch-exit`, `deep-link`) | Tauri event listeners (`@tauri-apps/api/event`) |
| Protocol + single instance handling | `tauri-plugin-deep-link` + `tauri-plugin-single-instance` |
| Folder/file pickers | `@tauri-apps/plugin-dialog` |
| Open path / external URL | `@tauri-apps/plugin-opener` + Rust validation |
| Download/extract/install in runtime bridge | Rust async commands + job state + progress events |
| Spawn/kill process tracking | Rust process registry + launch-exit events |
| Settings/auth files in Electron runtime | Rust settings + secure token storage |
| `electron-updater` flow | `tauri-plugin-updater` |

## 4) Proposed Fresh Folder Structure
```
Fresh/
  app/
  public/
  styles/
  main.tsx
  vite.config.ts
  src/desktop/bridge.ts
  src/desktop/events.ts
  src/desktop/webBridge.ts
  src-tauri/
    tauri.conf.json
    capabilities/default.json
    src/
      main.rs
      lib.rs
      state.rs
      models.rs
      error.rs
      core/
        paths.rs
        settings.rs
        download.rs
        archive.rs
        process_registry.rs
        itch_oauth.rs
        update.rs
      commands/
        install.rs
        launch.rs
        fs_ops.rs
        settings.rs
        itch.rs
        update.rs
```

## 5) Required Tauri Plugins and Rust Dependencies
### JS / Frontend
1. `@tauri-apps/api`
2. `@tauri-apps/cli`
3. `@tauri-apps/plugin-dialog`
4. `@tauri-apps/plugin-opener`
5. `@tauri-apps/plugin-deep-link`
6. `@tauri-apps/plugin-updater`
7. `@tauri-apps/plugin-single-instance`

### Rust
1. `tauri` and plugin crates listed above
2. `tokio`
3. `serde`, `serde_json`
4. `thiserror`, `anyhow`
5. `reqwest`
6. `uuid`
7. `dashmap`
8. `walkdir`
9. `url`, `regex`
10. Optional secure storage: `keyring` or `tauri-plugin-stronghold`

## 6) Rust Command Plan
### Install / Jobs
1. `install_archive`
2. `install_engine`
3. `cancel_install`

### Launch / Process
1. `launch_engine`
2. `get_running_launches`
3. `kill_launch`
4. `detect_wine_runtimes`
5. `scan_common_engine_paths`

### Filesystem / Import / Open
1. `inspect_path`
2. `list_directory`
3. `delete_path`
4. `import_engine_folder`
5. `import_mod_folder`
6. `open_path`
7. `open_any_path` (restricted/gated)
8. `open_external_url` (http/https only)

### Dialog / Settings / Deep Link
1. `pick_file`
2. `pick_folder`
3. `get_settings`
4. `update_settings`
5. `get_pending_deep_links` (compatibility shim)

### OAuth / Update
1. `get_itch_auth_status`
2. `clear_itch_auth`
3. `start_itch_oauth`
4. `list_itch_base_game_releases`
5. `resolve_itch_base_game_download`
6. `check_app_update`
7. `download_app_update`
8. `install_app_update`

### Event & Progress Model
1. Keep compatibility payloads for install progress, app update status, launch exit, deep-link notifications.
2. Include timestamps and `jobId` for install pipeline events.

### Error Handling Model
1. Typed codes: `INVALID_INPUT`, `PATH_OUTSIDE_ROOT`, `NOT_FOUND`, `IO_ERROR`, `NETWORK_ERROR`, `DOWNLOAD_FAILED`, `EXTRACT_FAILED`, `CANCELLED`, `PROCESS_SPAWN_FAILED`, `AUTH_REQUIRED`, `UPDATE_FAILED`, `INTERNAL`.
2. Return structured failures for expected domain errors and sanitized fallback for unknown failures.

## 7) Frontend Migration Plan
1. Keep existing pages/routes/components and preserve current UX behavior.
2. Replace all `window.funkhubDesktop` usage with `desktopBridge` abstraction.
3. Replace Electron event subscriptions with Tauri listeners.
4. Preserve current service contracts in `funkhubService` to reduce component churn.
5. Map picker/open/update/deeplink behavior to Tauri plugin APIs.
6. Branding conversion from `FunkHub` to `Fresh` across UI strings, storage keys, URLs, protocol, and assets.
7. Keep fallback web behavior where useful, but ensure desktop flow is Tauri-native.

## 8) Build / Configuration Plan
1. Update app metadata to `Fresh`:
   - name/product/window title: `Fresh`
   - identifier: `com.fresh.desktop` (or final org-specific equivalent)
2. Replace Electron scripts with Tauri scripts:
   - `tauri:dev`
   - `tauri:build`
   - per-platform bundle commands
3. Remove Electron dependencies: `electron`, `electron-builder`, `electron-updater`.
4. Configure `tauri.conf.json` with current window parity (1440x900, min 1100x700), icons, deep-link scheme (`fresh://`), updater options.
5. Update CI release/build workflows from Electron artifacts to Tauri bundle outputs.

## 9) QA Checklist
1. Startup/single-instance/deeplink behavior parity.
2. Frontend route/state parity across Discover/Library/Engines/Downloads/Settings.
3. API checks for GameBanana/GameJolt/release resolution/update checks.
4. Download/extraction/install/import parity including cancel/retry and nested archives.
5. Executable launch/kill parity with process exit events.
6. Permissions and safety checks (path traversal blocked, URL restrictions enforced).
7. Windows build verification first, then Linux/macOS smoke validation.
8. Regression pass for highest-risk workflows.

## 10) Risks and Mitigation
1. Monolithic Electron runtime bridge complexity.
   - Mitigation: decompose into Rust modules with stable command contracts.
2. Filesystem scope differences in Tauri.
   - Mitigation: strict root confinement + canonicalization + least-privilege capabilities.
3. Archive parity (`zip/7z/rar`) across OS.
   - Mitigation: explicit extractor strategy with tested fallback behavior.
4. Process launching differences by OS.
   - Mitigation: launcher abstraction with platform checks and matrix tests.
5. Updater behavior drift.
   - Mitigation: define UX parity contract before implementation.
6. Branding misses during rename.
   - Mitigation: dedicated branding checklist and review pass.

## 11) Implementation Phases (For Later)
1. Phase 0: Prepare `Fresh` baseline and freeze `FunkHub` as reference.
2. Phase 1: Scaffold Tauri 2 and apply `Fresh` metadata.
3. Phase 2: Add Rust module skeletons, commands, and capability model.
4. Phase 3: Implement download/extract/install parity in Rust.
5. Phase 4: Implement launch/process and filesystem/import parity.
6. Phase 5: Migrate frontend bridge and remove Electron API calls.
7. Phase 6: Implement deep-link, OAuth, and updater parity.
8. Phase 7: Remove Electron files/dependencies and finalize scripts/workflows.
9. Phase 8: Run full QA matrix and release hardening.

## Planned Commands For Later (Do Not Run Yet)
1. Copy baseline files from `FunkHub` to `Fresh` (excluding `.git`, build outputs, dependency folders).
2. Install/add Tauri dependencies.
3. Initialize Tauri project and icons.
4. Execute `tauri:dev` and `tauri:build` validations.

---
This document is intentionally planning-only and contains no executed migration actions.
