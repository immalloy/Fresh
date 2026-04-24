use std::collections::HashMap;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine;
use futures_util::StreamExt;
use regex::Regex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::fs;
use tokio::io::AsyncWriteExt;
use tokio_util::sync::CancellationToken;
use url::Url;
use walkdir::WalkDir;

#[derive(Default)]
struct AppState {
  jobs: Mutex<HashMap<String, CancellationToken>>,
  launches: Mutex<HashMap<String, RunningLaunch>>,
  pending_deep_links: Mutex<Vec<String>>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RunningLaunch {
  launch_id: String,
  install_path: String,
  start_time: u64,
  pid: u32,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopInstallRequest {
  job_id: String,
  file_name: String,
  mode: String,
  install_path: String,
  download_url: Option<String>,
  archive_base64: Option<String>,
  allow_missing_executable: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopInstallResult {
  install_path: String,
  version_detected: Option<String>,
  normalized: Option<bool>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstallProgress {
  job_id: String,
  phase: String,
  progress: f64,
  message: Option<String>,
  downloaded_bytes: Option<u64>,
  total_bytes: Option<u64>,
  speed_bytes_per_second: Option<f64>,
  timestamp: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LaunchPayload {
  install_path: String,
  launcher: Option<String>,
  launcher_path: Option<String>,
  executable_path: Option<String>,
  args: Option<Vec<String>>,
  launch_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PathPayload {
  target_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListDirectoryPayload {
  target_path: String,
  directories_only: Option<bool>,
  files_only: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportEngineFolderPayload {
  source_path: String,
  slug: String,
  version: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportModFolderPayload {
  source_path: String,
  target_mods_path: String,
  install_subdir: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KillLaunchPayload {
  launch_id: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RuntimeSettings {
  locale: Option<String>,
  game_directory: Option<String>,
  downloads_directory: Option<String>,
  data_root_directory: Option<String>,
  first_run_completed: Option<bool>,
  max_concurrent_downloads: Option<u32>,
  compatibility_checks: Option<bool>,
  check_app_updates_on_startup: Option<bool>,
  auto_download_app_updates: Option<bool>,
  auto_update_mods: Option<bool>,
  show_animations: Option<bool>,
  game_banana_integration: Option<serde_json::Value>,
  engine_launch_overrides: Option<serde_json::Value>,
}

impl Default for RuntimeSettings {
  fn default() -> Self {
    Self {
      locale: Some("en".to_string()),
      game_directory: Some(String::new()),
      downloads_directory: Some(String::new()),
      data_root_directory: Some(String::new()),
      first_run_completed: Some(false),
      max_concurrent_downloads: Some(3),
      compatibility_checks: Some(true),
      check_app_updates_on_startup: Some(true),
      auto_download_app_updates: Some(false),
      auto_update_mods: Some(false),
      show_animations: Some(true),
      game_banana_integration: Some(serde_json::json!({"pollingIntervalSeconds": 300})),
      engine_launch_overrides: Some(serde_json::json!({})),
    }
  }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ItchAuthStatus {
  connected: bool,
  connected_at: Option<u64>,
  scopes: Option<Vec<String>>,
}

fn now_ts() -> u64 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .unwrap_or(Duration::from_secs(0))
    .as_millis() as u64
}

fn app_state_dir(app: &AppHandle) -> PathBuf {
  app
    .path()
    .app_data_dir()
    .unwrap_or_else(|_| std::env::temp_dir())
    .join("fresh")
}

fn settings_path(app: &AppHandle) -> PathBuf {
  app_state_dir(app).join("settings.json")
}

fn itch_auth_path(app: &AppHandle) -> PathBuf {
  app_state_dir(app).join("itch-auth.json")
}

fn default_data_root() -> PathBuf {
  dirs::document_dir().unwrap_or_else(|| std::env::temp_dir()).join("Fresh")
}

fn default_download_root() -> PathBuf {
  dirs::download_dir().unwrap_or_else(|| std::env::temp_dir()).join("Fresh")
}

fn sanitize_rel_path(input: &str) -> String {
  input
    .replace('\\', "/")
    .split('/')
    .filter(|part| !part.is_empty() && *part != "." && *part != "..")
    .collect::<Vec<_>>()
    .join("/")
}

fn safe_join(root: &Path, target: &str) -> PathBuf {
  if Path::new(target).is_absolute() {
    return PathBuf::from(target);
  }
  root.join(sanitize_rel_path(target))
}

async fn ensure_dir(path: &Path) -> Result<(), String> {
  fs::create_dir_all(path).await.map_err(|e| e.to_string())
}

async fn read_settings(app: &AppHandle) -> RuntimeSettings {
  let path = settings_path(app);
  let Ok(content) = fs::read_to_string(path).await else {
    return RuntimeSettings::default();
  };
  serde_json::from_str::<RuntimeSettings>(&content).unwrap_or_default()
}

async fn write_settings(app: &AppHandle, settings: &RuntimeSettings) -> Result<(), String> {
  let path = settings_path(app);
  if let Some(parent) = path.parent() {
    ensure_dir(parent).await?;
  }
  let body = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
  fs::write(path, body).await.map_err(|e| e.to_string())
}

async fn effective_roots(app: &AppHandle) -> (PathBuf, PathBuf) {
  let settings = read_settings(app).await;
  let data_root = settings
    .data_root_directory
    .filter(|v| !v.trim().is_empty())
    .map(PathBuf::from)
    .unwrap_or_else(default_data_root);
  let downloads_root = settings
    .downloads_directory
    .filter(|v| !v.trim().is_empty())
    .map(PathBuf::from)
    .unwrap_or_else(default_download_root);
  (data_root, downloads_root)
}

fn emit_install_progress(app: &AppHandle, payload: InstallProgress) {
  let _ = app.emit("funkhub:install-progress", payload);
}

async fn download_to_file(
  app: &AppHandle,
  request: &DesktopInstallRequest,
  token: &CancellationToken,
  output: &Path,
) -> Result<(), String> {
  let Some(url) = &request.download_url else {
    return Err("downloadUrl is required".to_string());
  };
  let response = reqwest::Client::new()
    .get(url)
    .send()
    .await
    .map_err(|e| e.to_string())?;
  if !response.status().is_success() {
    return Err(format!("Download failed ({})", response.status()));
  }

  let total = response.content_length();
  let started = now_ts();
  let mut downloaded = 0u64;
  let mut stream = response.bytes_stream();
  let mut file = fs::File::create(output).await.map_err(|e| e.to_string())?;

  while let Some(item) = stream.next().await {
    if token.is_cancelled() {
      return Err("Download cancelled".to_string());
    }
    let chunk = item.map_err(|e| e.to_string())?;
    file.write_all(&chunk).await.map_err(|e| e.to_string())?;
    downloaded += chunk.len() as u64;
    let elapsed = ((now_ts().saturating_sub(started)) as f64 / 1000.0).max(0.001);
    emit_install_progress(
      app,
      InstallProgress {
        job_id: request.job_id.clone(),
        phase: "download".to_string(),
        progress: total.map(|t| downloaded as f64 / t as f64).unwrap_or(0.0),
        message: Some("Downloading archive".to_string()),
        downloaded_bytes: Some(downloaded),
        total_bytes: total,
        speed_bytes_per_second: Some(downloaded as f64 / elapsed),
        timestamp: now_ts(),
      },
    );
  }
  file.flush().await.map_err(|e| e.to_string())
}

async fn write_base64_archive(request: &DesktopInstallRequest, output: &Path) -> Result<(), String> {
  let Some(base64) = &request.archive_base64 else {
    return Err("archiveBase64 is required".to_string());
  };
  let bytes = base64::engine::general_purpose::STANDARD
    .decode(base64)
    .map_err(|e| e.to_string())?;
  fs::write(output, bytes).await.map_err(|e| e.to_string())
}

fn detect_archive_kind(path: &Path) -> String {
  path
    .extension()
    .and_then(OsStr::to_str)
    .unwrap_or("")
    .to_ascii_lowercase()
}

async fn extract_zip(archive: &Path, destination: &Path) -> Result<(), String> {
  let archive = archive.to_path_buf();
  let destination = destination.to_path_buf();
  tokio::task::spawn_blocking(move || -> Result<(), String> {
    let file = std::fs::File::open(&archive).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&destination).map_err(|e| e.to_string())?;

    for i in 0..zip.len() {
      let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
      let outpath = destination.join(entry.mangled_name());
      if entry.name().ends_with('/') {
        std::fs::create_dir_all(&outpath).map_err(|e| e.to_string())?;
      } else {
        if let Some(parent) = outpath.parent() {
          std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut outfile = std::fs::File::create(&outpath).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut outfile).map_err(|e| e.to_string())?;
      }
    }
    Ok(())
  })
  .await
  .map_err(|e| e.to_string())?
}

async fn extract_with_7z(archive: &Path, destination: &Path) -> Result<(), String> {
  let status = Command::new("7z")
    .arg("x")
    .arg("-y")
    .arg(format!("-o{}", destination.display()))
    .arg(archive)
    .stdout(Stdio::null())
    .stderr(Stdio::null())
    .status()
    .map_err(|e| e.to_string())?;
  if !status.success() {
    return Err("7z extraction failed".to_string());
  }
  Ok(())
}

async fn flatten_single_top_folder(path: &Path) -> Result<(), String> {
  let mut dirs = vec![];
  let mut files = vec![];
  let mut entries = fs::read_dir(path).await.map_err(|e| e.to_string())?;

  while let Some(entry) = entries.next_entry().await.map_err(|e| e.to_string())? {
    let name = entry.file_name().to_string_lossy().to_string();
    if name.starts_with("__MACOSX") {
      continue;
    }
    let kind = entry.file_type().await.map_err(|e| e.to_string())?;
    if kind.is_dir() {
      dirs.push(entry.path());
    } else {
      files.push(entry.path());
    }
  }

  if dirs.len() == 1 && files.is_empty() {
    let nested = dirs.remove(0);
    let mut nested_entries = fs::read_dir(&nested).await.map_err(|e| e.to_string())?;
    while let Some(entry) = nested_entries.next_entry().await.map_err(|e| e.to_string())? {
      let target = path.join(entry.file_name());
      if fs::metadata(&target).await.is_ok() {
        if entry.file_type().await.map_err(|e| e.to_string())?.is_dir() {
          let _ = fs::remove_dir_all(&target).await;
        } else {
          let _ = fs::remove_file(&target).await;
        }
      }
      fs::rename(entry.path(), &target).await.map_err(|e| e.to_string())?;
    }
    let _ = fs::remove_dir_all(nested).await;
  }
  Ok(())
}

fn detect_version_from_name(name: &str) -> Option<String> {
  let re = Regex::new(r"v?(\\d+\\.\\d+(?:\\.\\d+)?(?:[-+._A-Za-z0-9]+)?)").ok()?;
  re.captures(name)
    .and_then(|c| c.get(1).map(|m| m.as_str().to_string()))
}

fn find_launchable_executable(root: &Path, preferred: &[String]) -> Option<PathBuf> {
  let mut preferred_names: Vec<String> = preferred
    .iter()
    .map(|s| s.trim().to_ascii_lowercase())
    .filter(|s| !s.is_empty())
    .collect();
  for fallback in [
    "Funkin.exe",
    "Funkin",
    "FPSPlus.exe",
    "FPSPlus",
    "PsychEngine.exe",
    "CodenameEngine.exe",
  ] {
    preferred_names.push(fallback.to_ascii_lowercase());
  }

  let mut candidates = vec![];
  for entry in WalkDir::new(root).max_depth(4).follow_links(false).into_iter().flatten() {
    if !entry.file_type().is_file() {
      continue;
    }
    let path = entry.path();
    let name = path.file_name().and_then(OsStr::to_str).unwrap_or("").to_ascii_lowercase();
    #[cfg(target_os = "windows")]
    if !name.ends_with(".exe") {
      continue;
    }
    candidates.push(path.to_path_buf());
  }

  candidates.sort_by_key(|path| path.components().count());
  for preferred in preferred_names {
    if let Some(found) = candidates
      .iter()
      .find(|path| path.file_name().and_then(OsStr::to_str).unwrap_or("").to_ascii_lowercase().contains(&preferred))
      .cloned()
    {
      return Some(found);
    }
  }
  candidates.into_iter().next()
}

async fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
  let src = src.to_path_buf();
  let dst = dst.to_path_buf();
  tokio::task::spawn_blocking(move || -> Result<(), String> {
    std::fs::create_dir_all(&dst).map_err(|e| e.to_string())?;
    for entry in WalkDir::new(&src).follow_links(false).into_iter().flatten() {
      let entry_path = entry.path();
      let rel_path = entry_path
        .strip_prefix(&src)
        .map_err(|e| e.to_string())?;
      if rel_path.as_os_str().is_empty() {
        continue;
      }
      let dst_path = dst.join(rel_path);
      if entry.file_type().is_dir() {
        std::fs::create_dir_all(&dst_path).map_err(|e| e.to_string())?;
      } else if entry.file_type().is_file() {
        if let Some(parent) = dst_path.parent() {
          std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let _ = std::fs::copy(entry_path, &dst_path).map_err(|e| e.to_string())?;
      }
    }
    Ok(())
  })
  .await
  .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn install_archive(app: AppHandle, state: State<'_, AppState>, payload: DesktopInstallRequest) -> Result<DesktopInstallResult, String> {
  install_archive_inner(app, state, payload).await
}

#[tauri::command]
async fn install_engine(app: AppHandle, state: State<'_, AppState>, payload: DesktopInstallRequest) -> Result<DesktopInstallResult, String> {
  install_archive_inner(app, state, payload).await
}

async fn install_archive_inner(app: AppHandle, state: State<'_, AppState>, payload: DesktopInstallRequest) -> Result<DesktopInstallResult, String> {
  let job_id = payload.job_id.clone();
  let token = CancellationToken::new();
  {
    let mut jobs = state.jobs.lock().map_err(|_| "lock error".to_string())?;
    jobs.insert(job_id.clone(), token.clone());
  }

  let result = async {
    let (data_root, _) = effective_roots(&app).await;
    ensure_dir(&data_root).await?;

    let install_abs = safe_join(&data_root, &payload.install_path);
    if let Some(parent) = install_abs.parent() {
      ensure_dir(parent).await?;
    }

    let temp_root = app
      .path()
      .app_cache_dir()
      .unwrap_or_else(|_| std::env::temp_dir())
      .join("fresh")
      .join("jobs")
      .join(&job_id);
    ensure_dir(&temp_root).await?;

    let archive_path = temp_root.join(&payload.file_name);
    if payload.download_url.is_some() {
      download_to_file(&app, &payload, &token, &archive_path).await?;
    } else {
      write_base64_archive(&payload, &archive_path).await?;
    }

    emit_install_progress(
      &app,
      InstallProgress {
        job_id: job_id.clone(),
        phase: "extract".to_string(),
        progress: 0.0,
        message: Some("Extracting archive".to_string()),
        downloaded_bytes: None,
        total_bytes: None,
        speed_bytes_per_second: None,
        timestamp: now_ts(),
      },
    );

    let extract_dir = temp_root.join("extract");
    ensure_dir(&extract_dir).await?;
    match detect_archive_kind(&archive_path).as_str() {
      "zip" => extract_zip(&archive_path, &extract_dir).await?,
      "7z" | "rar" => extract_with_7z(&archive_path, &extract_dir).await?,
      _ => {
        ensure_dir(&install_abs).await?;
        let file_target = install_abs.join(&payload.file_name);
        let _ = fs::copy(&archive_path, file_target).await.map_err(|e| e.to_string())?;
        return Ok(DesktopInstallResult {
          install_path: payload.install_path.clone(),
          version_detected: detect_version_from_name(&payload.file_name),
          normalized: Some(false),
        });
      }
    }

    flatten_single_top_folder(&extract_dir).await?;
    if fs::metadata(&install_abs).await.is_ok() {
      if fs::metadata(&install_abs).await.map_err(|e| e.to_string())?.is_dir() {
        let _ = fs::remove_dir_all(&install_abs).await;
      } else {
        let _ = fs::remove_file(&install_abs).await;
      }
    }
    ensure_dir(&install_abs).await?;
    copy_dir_recursive(&extract_dir, &install_abs).await?;

    if payload.mode == "engine" {
      ensure_dir(&install_abs.join("mods")).await?;
      let launchable = find_launchable_executable(&install_abs, &[payload.file_name.clone(), "funkin".to_string()]);
      if launchable.is_none() && !payload.allow_missing_executable.unwrap_or(false) {
        return Err("Installed engine has no launchable executable".to_string());
      }
    }

    emit_install_progress(
      &app,
      InstallProgress {
        job_id: job_id.clone(),
        phase: "install".to_string(),
        progress: 1.0,
        message: Some("Install complete".to_string()),
        downloaded_bytes: None,
        total_bytes: None,
        speed_bytes_per_second: None,
        timestamp: now_ts(),
      },
    );

    Ok(DesktopInstallResult {
      install_path: payload.install_path.clone(),
      version_detected: detect_version_from_name(&payload.file_name),
      normalized: Some(true),
    })
  }
  .await;

  {
    let mut jobs = state.jobs.lock().map_err(|_| "lock error".to_string())?;
    jobs.remove(&job_id);
  }

  if let Err(err) = &result {
    emit_install_progress(
      &app,
      InstallProgress {
        job_id: job_id.clone(),
        phase: "error".to_string(),
        progress: 1.0,
        message: Some(err.clone()),
        downloaded_bytes: None,
        total_bytes: None,
        speed_bytes_per_second: None,
        timestamp: now_ts(),
      },
    );
  }
  result
}

#[tauri::command]
fn cancel_install(state: State<'_, AppState>, payload: serde_json::Value) -> Result<serde_json::Value, String> {
  let job_id = payload
    .get("jobId")
    .and_then(|v| v.as_str())
    .ok_or_else(|| "jobId is required".to_string())?
    .to_string();

  let jobs = state.jobs.lock().map_err(|_| "lock error".to_string())?;
  if let Some(token) = jobs.get(&job_id) {
    token.cancel();
  }
  Ok(serde_json::json!({ "ok": true }))
}

#[tauri::command]
async fn launch_engine(app: AppHandle, state: State<'_, AppState>, payload: LaunchPayload) -> Result<serde_json::Value, String> {
  let (data_root, _) = effective_roots(&app).await;
  let install_abs = safe_join(&data_root, &payload.install_path);
  let launch_id = payload.launch_id.clone().unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

  let executable = if let Some(path) = payload.executable_path.as_ref().filter(|v| !v.trim().is_empty()) {
    if Path::new(path).is_absolute() {
      PathBuf::from(path)
    } else {
      install_abs.join(path)
    }
  } else {
    find_launchable_executable(&install_abs, &[payload.install_path.clone()])
      .ok_or_else(|| "No launchable executable found".to_string())?
  };

  let mut command = if let Some(mode) = payload.launcher.clone().filter(|v| !v.trim().is_empty()) {
    match mode.as_str() {
      "wine" | "wine64" | "proton" => {
        let launcher = payload.launcher_path.clone().filter(|v| !v.trim().is_empty()).unwrap_or(mode);
        let mut c = Command::new(launcher);
        c.arg(&executable);
        c
      }
      _ => Command::new(&executable),
    }
  } else {
    Command::new(&executable)
  };

  if let Some(args) = payload.args {
    command.args(args);
  }
  command.current_dir(if install_abs.is_dir() { install_abs.clone() } else { install_abs.parent().unwrap_or(Path::new(".")).to_path_buf() });

  let mut child = command.spawn().map_err(|e| format!("Failed to launch executable: {e}"))?;
  let pid = child.id();
  {
    let mut launches = state.launches.lock().map_err(|_| "lock error".to_string())?;
    launches.insert(
      launch_id.clone(),
      RunningLaunch {
        launch_id: launch_id.clone(),
        install_path: payload.install_path.clone(),
        start_time: now_ts(),
        pid,
      },
    );
  }

  let app_clone = app.clone();
  let launch_id_clone = launch_id.clone();
  std::thread::spawn(move || {
    let _ = child.wait();
    let _ = app_clone.emit("funkhub:launch-exit", serde_json::json!({ "launchId": launch_id_clone }));
  });

  Ok(serde_json::json!({ "ok": true, "launchedPath": executable.to_string_lossy().to_string() }))
}

#[tauri::command]
fn get_running_launches(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
  let launches = state.launches.lock().map_err(|_| "lock error".to_string())?;
  let list: Vec<_> = launches.values().cloned().collect();
  Ok(serde_json::json!({ "launches": list }))
}

#[tauri::command]
fn kill_launch(state: State<'_, AppState>, payload: KillLaunchPayload) -> Result<serde_json::Value, String> {
  let launches = state.launches.lock().map_err(|_| "lock error".to_string())?;
  let Some(launch) = launches.get(&payload.launch_id) else {
    return Ok(serde_json::json!({ "ok": false, "message": "No running process found" }));
  };

  #[cfg(target_os = "windows")]
  {
    let _ = Command::new("taskkill")
      .arg("/PID")
      .arg(launch.pid.to_string())
      .arg("/F")
      .arg("/T")
      .stdout(Stdio::null())
      .stderr(Stdio::null())
      .status();
  }
  #[cfg(not(target_os = "windows"))]
  {
    let _ = Command::new("kill")
      .arg("-TERM")
      .arg(launch.pid.to_string())
      .stdout(Stdio::null())
      .stderr(Stdio::null())
      .status();
  }

  Ok(serde_json::json!({ "ok": true }))
}

#[tauri::command]
async fn open_path(app: AppHandle, payload: PathPayload) -> Result<serde_json::Value, String> {
  let (data_root, _) = effective_roots(&app).await;
  let target = safe_join(&data_root, &payload.target_path);
  open::that(&target).map_err(|e| e.to_string())?;
  Ok(serde_json::json!({ "ok": true, "openedPath": target.to_string_lossy().to_string() }))
}

#[tauri::command]
async fn open_any_path(payload: PathPayload) -> Result<serde_json::Value, String> {
  let target = PathBuf::from(payload.target_path);
  open::that(&target).map_err(|e| e.to_string())?;
  Ok(serde_json::json!({ "ok": true, "openedPath": target.to_string_lossy().to_string() }))
}

#[tauri::command]
fn open_external_url(payload: serde_json::Value) -> Result<serde_json::Value, String> {
  let url = payload.get("url").and_then(|v| v.as_str()).ok_or_else(|| "url is required".to_string())?;
  let parsed = Url::parse(url).map_err(|e| e.to_string())?;
  let scheme = parsed.scheme();
  if scheme != "http" && scheme != "https" {
    return Ok(serde_json::json!({ "ok": false, "error": "Only http/https URLs are supported" }));
  }
  open::that(url).map_err(|e| e.to_string())?;
  Ok(serde_json::json!({ "ok": true }))
}

#[tauri::command]
async fn delete_path(app: AppHandle, payload: PathPayload) -> Result<serde_json::Value, String> {
  let (data_root, _) = effective_roots(&app).await;
  let target = safe_join(&data_root, &payload.target_path);
  if fs::metadata(&target).await.is_ok() {
    if fs::metadata(&target).await.map_err(|e| e.to_string())?.is_dir() {
      let _ = fs::remove_dir_all(&target).await;
    } else {
      let _ = fs::remove_file(&target).await;
    }
  }
  Ok(serde_json::json!({ "ok": true, "deletedPath": target.to_string_lossy().to_string() }))
}

#[tauri::command]
async fn inspect_path(app: AppHandle, payload: PathPayload) -> Result<serde_json::Value, String> {
  let (data_root, _) = effective_roots(&app).await;
  let target = safe_join(&data_root, &payload.target_path);
  let exists = fs::metadata(&target).await.is_ok();
  let is_directory = if exists { fs::metadata(&target).await.map(|m| m.is_dir()).unwrap_or(false) } else { false };
  Ok(serde_json::json!({
    "ok": true,
    "exists": exists,
    "isDirectory": is_directory,
    "absolutePath": target.to_string_lossy().to_string()
  }))
}

#[tauri::command]
async fn list_directory(app: AppHandle, payload: ListDirectoryPayload) -> Result<serde_json::Value, String> {
  let (data_root, _) = effective_roots(&app).await;
  let target = safe_join(&data_root, &payload.target_path);
  let mut entries = vec![];
  let mut rd = match fs::read_dir(&target).await {
    Ok(rd) => rd,
    Err(error) => return Ok(serde_json::json!({ "ok": false, "entries": [], "error": error.to_string() })),
  };

  while let Some(entry) = rd.next_entry().await.map_err(|e| e.to_string())? {
    let ty = entry.file_type().await.map_err(|e| e.to_string())?;
    let is_dir = ty.is_dir();
    if payload.directories_only.unwrap_or(false) && !is_dir {
      continue;
    }
    if payload.files_only.unwrap_or(false) && is_dir {
      continue;
    }
    entries.push(serde_json::json!({
      "name": entry.file_name().to_string_lossy().to_string(),
      "path": entry.path().to_string_lossy().to_string(),
      "isDirectory": is_dir
    }));
  }

  Ok(serde_json::json!({ "ok": true, "entries": entries }))
}

#[tauri::command]
async fn import_engine_folder(app: AppHandle, payload: ImportEngineFolderPayload) -> Result<serde_json::Value, String> {
  let source = PathBuf::from(&payload.source_path);
  if !source.is_dir() {
    return Ok(serde_json::json!({ "ok": false, "error": "sourcePath must be a directory" }));
  }

  let (data_root, _) = effective_roots(&app).await;
  let version = payload
    .version
    .clone()
    .unwrap_or_else(|| "imported".to_string())
    .replace(|c: char| !c.is_ascii_alphanumeric() && c != '.' && c != '-' && c != '_', "-");
  let relative_install = format!("engines/{}/{}-{}", payload.slug, version, now_ts());
  let install_abs = safe_join(&data_root, &relative_install);

  ensure_dir(install_abs.parent().unwrap_or(&data_root)).await?;
  copy_dir_recursive(&source, &install_abs).await?;
  ensure_dir(&install_abs.join("mods")).await?;

  if find_launchable_executable(&install_abs, &[payload.slug.clone(), "funkin".to_string()]).is_none() {
    let _ = fs::remove_dir_all(&install_abs).await;
    return Ok(serde_json::json!({ "ok": false, "error": "Imported folder has no launchable executable for this platform" }));
  }

  Ok(serde_json::json!({
    "ok": true,
    "installPath": relative_install,
    "modsPath": format!("{}/mods", relative_install),
    "detectedVersion": payload.version.or_else(|| detect_version_from_name(source.file_name().and_then(OsStr::to_str).unwrap_or(""))).unwrap_or_else(|| "imported".to_string())
  }))
}

#[tauri::command]
async fn import_mod_folder(app: AppHandle, payload: ImportModFolderPayload) -> Result<serde_json::Value, String> {
  let source = PathBuf::from(&payload.source_path);
  if !source.is_dir() {
    return Ok(serde_json::json!({ "ok": false, "error": "sourcePath must be a directory" }));
  }

  let (data_root, _) = effective_roots(&app).await;
  let target_root = safe_join(&data_root, &payload.target_mods_path);
  let target_install = safe_join(&data_root, &format!("{}/{}", payload.target_mods_path, payload.install_subdir));

  ensure_dir(&target_root).await?;
  if fs::metadata(&target_install).await.is_ok() {
    let _ = fs::remove_dir_all(&target_install).await;
  }
  copy_dir_recursive(&source, &target_install).await?;

  let rel = target_install
    .strip_prefix(&data_root)
    .map(|p| p.to_string_lossy().replace('\\', "/"))
    .unwrap_or_else(|_| target_install.to_string_lossy().replace('\\', "/"));
  Ok(serde_json::json!({ "ok": true, "installPath": rel }))
}

#[tauri::command]
async fn get_settings(app: AppHandle) -> Result<serde_json::Value, String> {
  let mut settings = read_settings(&app).await;
  let (data_root, downloads_root) = effective_roots(&app).await;
  settings.data_root_directory = Some(data_root.to_string_lossy().to_string());
  settings.downloads_directory = Some(downloads_root.to_string_lossy().to_string());
  serde_json::to_value(settings).map_err(|e| e.to_string())
}

#[tauri::command]
async fn update_settings(app: AppHandle, payload: serde_json::Value) -> Result<serde_json::Value, String> {
  let mut current = read_settings(&app).await;
  if let Ok(patch) = serde_json::from_value::<RuntimeSettings>(payload) {
    current.locale = patch.locale.or(current.locale);
    current.game_directory = patch.game_directory.or(current.game_directory);
    current.downloads_directory = patch.downloads_directory.or(current.downloads_directory);
    current.data_root_directory = patch.data_root_directory.or(current.data_root_directory);
    current.first_run_completed = patch.first_run_completed.or(current.first_run_completed);
    current.max_concurrent_downloads = patch.max_concurrent_downloads.or(current.max_concurrent_downloads);
    current.compatibility_checks = patch.compatibility_checks.or(current.compatibility_checks);
    current.check_app_updates_on_startup = patch.check_app_updates_on_startup.or(current.check_app_updates_on_startup);
    current.auto_download_app_updates = patch.auto_download_app_updates.or(current.auto_download_app_updates);
    current.auto_update_mods = patch.auto_update_mods.or(current.auto_update_mods);
    current.show_animations = patch.show_animations.or(current.show_animations);
    current.game_banana_integration = patch.game_banana_integration.or(current.game_banana_integration);
    current.engine_launch_overrides = patch.engine_launch_overrides.or(current.engine_launch_overrides);
  }
  write_settings(&app, &current).await?;
  serde_json::to_value(current).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_pending_deep_links(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
  let mut links = state.pending_deep_links.lock().map_err(|_| "lock error".to_string())?;
  let drained: Vec<String> = links.drain(..).collect();
  Ok(serde_json::json!({ "links": drained }))
}

#[tauri::command]
async fn inspect_engine_install(app: AppHandle, payload: serde_json::Value) -> Result<serde_json::Value, String> {
  let install_path = payload.get("installPath").and_then(|v| v.as_str()).ok_or_else(|| "installPath is required".to_string())?;
  let (data_root, _) = effective_roots(&app).await;
  let install_abs = safe_join(&data_root, install_path);

  if fs::metadata(&install_abs).await.is_err() {
    return Ok(serde_json::json!({ "ok": true, "health": "broken_install", "message": "Installation path not found" }));
  }
  if let Some(path) = find_launchable_executable(&install_abs, &[install_path.to_string()]) {
    return Ok(serde_json::json!({ "ok": true, "health": "ready", "launchablePath": path.to_string_lossy().to_string() }));
  }
  Ok(serde_json::json!({ "ok": true, "health": "missing_binary", "message": "No launchable executable found" }))
}

#[tauri::command]
fn check_app_update() -> Result<serde_json::Value, String> {
  Ok(serde_json::json!({
    "ok": false,
    "error": "Native updater backend is not configured in this build. Falling back to frontend release checker."
  }))
}

#[tauri::command]
fn download_app_update() -> Result<serde_json::Value, String> {
  Ok(serde_json::json!({ "ok": false, "error": "Use frontend updater plugin flow" }))
}

#[tauri::command]
fn install_app_update() -> Result<serde_json::Value, String> {
  Ok(serde_json::json!({ "ok": false, "error": "Use frontend updater plugin flow" }))
}

#[tauri::command]
async fn get_itch_auth_status(app: AppHandle) -> Result<ItchAuthStatus, String> {
  let path = itch_auth_path(&app);
  let Ok(content) = fs::read_to_string(path).await else {
    return Ok(ItchAuthStatus { connected: false, connected_at: None, scopes: None });
  };
  let parsed = serde_json::from_str::<serde_json::Value>(&content).unwrap_or_default();
  let token = parsed.get("accessToken").and_then(|v| v.as_str()).unwrap_or("");
  let connected_at = parsed.get("connectedAt").and_then(|v| v.as_u64());
  let scopes = parsed
    .get("scopes")
    .and_then(|v| v.as_array())
    .map(|values| values.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect::<Vec<_>>());
  Ok(ItchAuthStatus { connected: !token.is_empty(), connected_at, scopes })
}

#[tauri::command]
async fn clear_itch_auth(app: AppHandle) -> Result<serde_json::Value, String> {
  let path = itch_auth_path(&app);
  if fs::metadata(&path).await.is_ok() {
    let _ = fs::remove_file(path).await;
  }
  Ok(serde_json::json!({ "ok": true }))
}

#[tauri::command]
fn start_itch_oauth(_payload: serde_json::Value) -> Result<serde_json::Value, String> {
  Ok(serde_json::json!({ "ok": false, "message": "itch OAuth desktop flow is not fully migrated yet." }))
}

#[tauri::command]
fn list_itch_base_game_releases() -> Result<serde_json::Value, String> {
  Ok(serde_json::json!({
    "ok": false,
    "requiresAuth": true,
    "message": "Connect itch.io account support is not yet available in this build.",
    "releases": []
  }))
}

#[tauri::command]
fn resolve_itch_base_game_download(_payload: serde_json::Value) -> Result<serde_json::Value, String> {
  Ok(serde_json::json!({
    "ok": false,
    "requiresAuth": true,
    "message": "Connect itch.io account support is not yet available in this build."
  }))
}

#[tauri::command]
fn detect_wine_runtimes() -> Result<serde_json::Value, String> {
  #[cfg(target_os = "linux")]
  {
    let mut runtimes = vec![];
    for p in ["/usr/bin/wine", "/usr/bin/wine64", "/usr/local/bin/wine", "/usr/local/bin/wine64"] {
      if Path::new(p).exists() {
        let label = if p.contains("wine64") { "Wine64" } else { "Wine" };
        let kind = if p.contains("wine64") { "wine64" } else { "wine" };
        runtimes.push(serde_json::json!({ "type": kind, "path": p, "label": label }));
      }
    }
    return Ok(serde_json::json!({ "runtimes": runtimes }));
  }
  #[cfg(not(target_os = "linux"))]
  {
    Ok(serde_json::json!({ "runtimes": [] }))
  }
}

#[tauri::command]
fn scan_common_engine_paths() -> Result<serde_json::Value, String> {
  #[cfg(target_os = "linux")]
  {
    let mut found = vec![];
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));
    for root in [home.join("Games"), home.join(".local/share"), home.join("Applications"), PathBuf::from("/opt")] {
      if !root.exists() {
        continue;
      }
      for entry in WalkDir::new(&root).max_depth(3).into_iter().flatten() {
        if !entry.file_type().is_file() {
          continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if ["Funkin", "FunkinLinux64", "FPSPlus"].contains(&name.as_str()) {
          if let Some(parent) = entry.path().parent() {
            found.push(parent.to_string_lossy().to_string());
          }
        }
      }
    }
    found.sort();
    found.dedup();
    return Ok(serde_json::json!({ "paths": found }));
  }
  #[cfg(not(target_os = "linux"))]
  {
    Ok(serde_json::json!({ "paths": [] }))
  }
}

pub fn run() {
  tauri::Builder::default()
    .manage(AppState::default())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_deep_link::init())
    .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
      if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_focus();
      }
      if let Some(link) = argv.iter().find(|arg| arg.starts_with("fresh:") || arg.starts_with("funkhub:")) {
        let state = app.state::<AppState>();
        if let Ok(mut pending) = state.pending_deep_links.lock() {
          pending.push(link.to_string());
        }
        let _ = app.emit("funkhub:deep-link", serde_json::json!({ "url": link }));
      }
    }))
    .invoke_handler(tauri::generate_handler![
      install_archive,
      install_engine,
      cancel_install,
      launch_engine,
      get_running_launches,
      kill_launch,
      open_path,
      open_any_path,
      open_external_url,
      delete_path,
      inspect_path,
      list_directory,
      import_engine_folder,
      import_mod_folder,
      get_settings,
      update_settings,
      get_pending_deep_links,
      inspect_engine_install,
      check_app_update,
      download_app_update,
      install_app_update,
      get_itch_auth_status,
      clear_itch_auth,
      start_itch_oauth,
      list_itch_base_game_releases,
      resolve_itch_base_game_download,
      detect_wine_runtimes,
      scan_common_engine_paths
    ])
    .setup(|app| {
      let handle = app.handle();
      let args: Vec<String> = std::env::args().collect();
      if let Some(link) = args.iter().find(|arg| arg.starts_with("fresh:") || arg.starts_with("funkhub:")) {
        let state = handle.state::<AppState>();
        let lock_result = state.pending_deep_links.lock();
        if let Ok(mut pending) = lock_result {
          pending.push(link.to_string());
        }
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
