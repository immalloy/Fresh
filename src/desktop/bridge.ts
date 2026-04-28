import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { getCurrent as getCurrentDeepLinks, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import type { DesktopBridge } from "../../app/services/fresh";

function asPromise<T>(value: Promise<T>): Promise<T> {
  return value;
}

function toUnsubscribe(unlistenPromise: Promise<UnlistenFn>): () => void {
  return () => {
    void unlistenPromise.then((unlisten) => unlisten()).catch(() => undefined);
  };
}

function toUnsubscribeMany(unlistenPromises: Promise<UnlistenFn>[]): () => void {
  return () => {
    for (const unlistenPromise of unlistenPromises) {
      void unlistenPromise.then((unlisten) => unlisten()).catch(() => undefined);
    }
  };
}

function listenCompat<TPayload>(eventNames: string[], listener: (payload: TPayload) => void): () => void {
  const unlistenPromises = eventNames.map((eventName) => listen(eventName, (event) => listener(event.payload as TPayload)));
  return toUnsubscribeMany(unlistenPromises);
}

export function createDesktopBridge(): DesktopBridge {
  return {
    installArchive: (payload) => asPromise(invoke("install_archive", { payload })),
    installEngine: (payload) => asPromise(invoke("install_engine", { payload })),
    cancelInstall: (payload) => asPromise(invoke("cancel_install", { payload })),
    launchEngine: (payload) => asPromise(invoke("launch_engine", { payload })),
    openPath: (payload) => asPromise(invoke("open_path", { payload })),
    openAnyPath: (payload) => asPromise(invoke("open_any_path", { payload })),
    openExternalUrl: (payload) => asPromise(invoke("open_external_url", { payload })),
    deletePath: (payload) => asPromise(invoke("delete_path", { payload })),
    getItchAuthStatus: () => asPromise(invoke("get_itch_auth_status")),
    clearItchAuth: () => asPromise(invoke("clear_itch_auth")),
    startItchOAuth: (payload) => asPromise(invoke("start_itch_oauth", { payload })),
    listItchBaseGameReleases: () => asPromise(invoke("list_itch_base_game_releases")),
    resolveItchBaseGameDownload: (payload) => asPromise(invoke("resolve_itch_base_game_download", { payload })),
    inspectEngineInstall: (payload) => asPromise(invoke("inspect_engine_install", { payload })),
    inspectPath: (payload) => asPromise(invoke("inspect_path", { payload })),
    listDirectory: (payload) => asPromise(invoke("list_directory", { payload })),
    importEngineFolder: (payload) => asPromise(invoke("import_engine_folder", { payload })),
    importModFolder: (payload) => asPromise(invoke("import_mod_folder", { payload })),
    getSettings: () => asPromise(invoke("get_settings")),
    updateSettings: (payload) => asPromise(invoke("update_settings", { payload })),
    getRunningLaunches: () => asPromise(invoke("get_running_launches")),
    killLaunch: (payload) => asPromise(invoke("kill_launch", { payload })),
    detectWineRuntimes: () => asPromise(invoke("detect_wine_runtimes")),
    scanCommonEnginePaths: () => asPromise(invoke("scan_common_engine_paths")),
    getPendingDeepLinks: async () => {
      try {
        const links = await getCurrentDeepLinks();
        return { links: links ?? [] };
      } catch {
        return { links: [] };
      }
    },
    pickFolder: async (payload) => {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: payload?.title,
        defaultPath: payload?.defaultPath,
      });
      if (!selected || Array.isArray(selected)) {
        return { canceled: true };
      }
      return { canceled: false, path: selected };
    },
    pickFile: async (payload) => {
      const selected = await openDialog({
        directory: false,
        multiple: false,
        title: payload?.title,
        defaultPath: payload?.defaultPath,
        filters: payload?.filters,
      });
      if (!selected || Array.isArray(selected)) {
        return { canceled: true };
      }
      return { canceled: false, path: selected };
    },
    checkAppUpdate: async () => {
      return asPromise(invoke("check_app_update"));
    },
    downloadAppUpdate: async () => {
      return asPromise(invoke("download_app_update"));
    },
    installAppUpdate: async () => {
      return asPromise(invoke("install_app_update"));
    },
    onDeepLink: (listener) => {
      const unlisten = onOpenUrl((urls) => {
        for (const url of urls ?? []) {
          listener({ url });
        }
      });
      return () => {
        void unlisten.then((dispose) => dispose()).catch(() => undefined);
      };
    },
    onInstallProgress: (listener) => listenCompat(
      ["fresh:install-progress", "fresh:install-progress"],
      (payload: Parameters<typeof listener>[0]) => listener(payload),
    ),
    onAppUpdateStatus: (listener) => listenCompat(
      ["fresh:app-update", "fresh:app-update"],
      (payload: Parameters<typeof listener>[0]) => listener(payload),
    ),
    onLaunchExit: (listener) => listenCompat(
      ["fresh:launch-exit", "fresh:launch-exit"],
      (payload: Parameters<typeof listener>[0]) => listener(payload),
    ),
  };
}
