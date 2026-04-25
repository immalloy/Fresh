import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { freshService } from "../../services/fresh";
import {
  ALL_SEARCH_FIELDS,
  AppUpdateInfo,
  CategoryNode,
  ContentRating,
  DesktopAppUpdateStatus,
  DownloadTask,
  EngineDefinition,
  FreshSettings,
  GameBananaModProfile,
  GameBananaModSummary,
  InstallOptions,
  InstalledEngine,
  InstalledMod,
  ModUpdateInfo,
  ReleaseType,
  SearchField,
  SearchSortOrder,
  type SubfeedSort,
} from "../../services/fresh";
import { parseFreshDeepLink } from "../../services/fresh/deepLink";
import { modInstallerService } from "../../services/fresh/installer";
import { freshStorageService, DEFAULT_SETTINGS } from "../../services/fresh/storage";
import { normalizeLocale, translate } from "../../i18n";

interface FreshContextValue {
  loading: boolean;
  bestOfMods: GameBananaModSummary[];
  discoverMods: GameBananaModSummary[];
  categories: CategoryNode[];
  installedMods: InstalledMod[];
  modUpdates: ModUpdateInfo[];
  downloads: DownloadTask[];
  enginesCatalog: EngineDefinition[];
  installedEngines: InstalledEngine[];
  settings: FreshSettings;
  itchAuth: { connected: boolean; connectedAt?: number; scopes?: string[] };
  selectedCategoryId?: number;
  setSelectedCategoryId: (categoryId?: number) => void;
  subfeedSort: SubfeedSort;
  setSubfeedSort: (value: SubfeedSort) => void;
  categorySort: string;
  setCategorySort: (value: string) => void;
  discoverPage: number;
  setDiscoverPage: (page: number) => void;
  discoverPerPage: number;
  hasMoreDiscover: boolean;
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  searchOrder: SearchSortOrder;
  setSearchOrder: (order: SearchSortOrder) => void;
  searchFields: SearchField[];
  setSearchFields: (fields: SearchField[]) => void;
  browseReleaseType: ReleaseType;
  setBrowseReleaseType: (value: ReleaseType) => void;
  browseContentRatings: ContentRating[];
  setBrowseContentRatings: (value: ContentRating[]) => void;
  refreshDiscover: () => Promise<void>;
  refreshModUpdates: () => Promise<void>;
  getModProfile: (modId: number) => Promise<GameBananaModProfile>;
  listModsBySubmitter: (input: { submitterId: number; categoryId?: number; page?: number; perPage?: number }) => Promise<GameBananaModSummary[]>;
  installMod: (modId: number, fileId: number, selectedEngineId?: string, priority?: number, options?: InstallOptions) => { ok: boolean; error?: string };
  installEngine: (slug: InstalledEngine["slug"], downloadUrl: string, version: string, options?: { allowMissingExecutable?: boolean }) => Promise<void>;
  importEngineFromFolder: (slug: InstalledEngine["slug"], versionHint?: string, sourcePath?: string, customName?: string) => Promise<void>;
  updateEngine: (engineId: string) => Promise<void>;
  uninstallEngine: (engineId: string) => Promise<void>;
  launchEngine: (
    engineId: string,
    options?: {
      launcher?: "native" | "wine" | "wine64" | "proton";
      launcherPath?: string;
      executablePath?: string;
    },
  ) => Promise<void>;
  openEngineFolder: (engineId: string) => Promise<void>;
  openEngineModsFolder: (engineId: string) => Promise<void>;
  getEngineHealth: (engineId: string) => { health: "ready" | "missing_binary" | "broken_install"; message?: string };
  refreshEngineHealth: (engineId?: string) => Promise<void>;
  launchInstalledMod: (installedId: string) => Promise<void>;
  updateInstalledModLaunchOptions: (
    installedId: string,
    options: { launcher?: "native" | "wine" | "wine64" | "proton"; launcherPath?: string; executablePath?: string },
  ) => Promise<void>;
  cancelDownload: (taskId: string) => void;
  retryDownload: (taskId: string) => void;
  clearDownloads: () => void;
  setDefaultEngine: (engineId: string) => void;
  renameEngine: (engineId: string, name: string) => void;
  setEngineCustomIcon: (engineId: string, iconUrl?: string) => void;
  setModCustomImage: (installedId: string, imageUrl?: string) => void;
  setModEnabled: (installedId: string, enabled: boolean) => void;
  setModTags: (installedId: string, tags: string[]) => void;
  setModPinned: (installedId: string, pinned: boolean) => void;
  setModNotes: (installedId: string, notes: string) => void;
  renameInstalledMod: (installedId: string, newName: string) => void;
  openExternalUrl: (url: string) => Promise<void>;
  removeInstalledMod: (installedId: string, options?: { deleteFiles?: boolean }) => Promise<void>;
  updateSettings: (patch: Partial<FreshSettings>) => Promise<void>;
  browseFolder: (options?: { title?: string; defaultPath?: string }) => Promise<string | undefined>;
  browseFile: (options?: { title?: string; defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> }) => Promise<string | undefined>;
  openFolderPath: (targetPath: string) => Promise<void>;
  addManualMod: (input: { modName: string; engineId?: string; sourcePath?: string; description?: string; version?: string; author?: string; standalone?: boolean; gameBananaUrl?: string }) => Promise<void>;
  autodetectInstalledMods: () => Promise<number>;
  reconcileDiskState: () => Promise<void>;
  connectItch: (clientId: string) => Promise<void>;
  disconnectItch: () => Promise<void>;
  refreshItchAuth: () => Promise<void>;
  appUpdate: AppUpdateInfo | undefined;
  appUpdateError?: string;
  appUpdateChecking: boolean;
  checkAppUpdate: () => Promise<void>;
  openAppUpdateDownload: () => Promise<void>;
  downloadAppUpdate: () => Promise<void>;
  installAppUpdate: () => Promise<void>;
  appUpdateStatus?: DesktopAppUpdateStatus;
  runningLaunchIds: Set<string>;
  killLaunch: (launchId: string) => Promise<void>;
  detectWineRuntimes: () => Promise<Array<{ type: "wine" | "wine64" | "proton"; path: string; label: string }>>;
  scanCommonEnginePaths: () => Promise<string[]>;
  clearAllData: () => Promise<void>;
  clearAllMods: () => Promise<void>;
  clearAllEngines: () => Promise<void>;
  clearAllDownloads: () => Promise<void>;
  resetSettings: () => Promise<void>;
  clearTheme: () => Promise<void>;
  clearCompletedDownloads: () => Promise<void>;
  clearFailedDownloads: () => Promise<void>;
  clearActiveDownloads: () => Promise<void>;
  clearDisabledMods: () => Promise<void>;
  clearUnpinnedMods: () => Promise<void>;
}

const FreshContext = createContext<FreshContextValue | undefined>(undefined);

export function FreshProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [bestOfMods, setBestOfMods] = useState<GameBananaModSummary[]>([]);
  const [discoverMods, setDiscoverMods] = useState<GameBananaModSummary[]>([]);
  const [categories, setCategories] = useState<CategoryNode[]>([]);
  const [downloads, setDownloads] = useState<DownloadTask[]>(freshService.getDownloadHistory());
  const [enginesCatalog, setEnginesCatalog] = useState<EngineDefinition[]>([]);
  const [installedMods, setInstalledMods] = useState<InstalledMod[]>(freshService.getInstalledMods());
  const [modUpdates, setModUpdates] = useState<ModUpdateInfo[]>(freshService.getModUpdates());
  const [installedEngines, setInstalledEngines] = useState<InstalledEngine[]>(freshService.getInstalledEngines());
  const [settings, setSettings] = useState<FreshSettings>(freshService.getSettings());
  const [itchAuth, setItchAuth] = useState<{ connected: boolean; connectedAt?: number; scopes?: string[] }>({ connected: false });
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | undefined>(undefined);
  const [subfeedSort, setSubfeedSort] = useState<SubfeedSort>("default");
  const [categorySort, setCategorySort] = useState("Generic_Newest");
  const [discoverPage, setDiscoverPage] = useState(1);
  const discoverPerPage = 24;
  const [hasMoreDiscover, setHasMoreDiscover] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [searchOrder, setSearchOrder] = useState<SearchSortOrder>("best_match");
  const [searchFields, setSearchFields] = useState<SearchField[]>(ALL_SEARCH_FIELDS);
  const [browseReleaseType, setBrowseReleaseType] = useState<ReleaseType>("");
  const [browseContentRatings, setBrowseContentRatings] = useState<ContentRating[]>([]);
  const processedDeepLinksRef = useRef<Map<string, number>>(new Map());
  const processingDeepLinksRef = useRef<Set<string>>(new Set());
  const discoverRequestIdRef = useRef(0);
  const [appUpdate, setAppUpdate] = useState<AppUpdateInfo | undefined>(undefined);
  const [appUpdateChecking, setAppUpdateChecking] = useState(false);
  const [appUpdateError, setAppUpdateError] = useState<string | undefined>(undefined);
  const [appUpdateStatus, setAppUpdateStatus] = useState<DesktopAppUpdateStatus | undefined>(
    freshService.getDesktopAppUpdateStatus(),
  );
  const startupUpdateCheckedRef = useRef(false);
  const [runningLaunchIds, setRunningLaunchIds] = useState<Set<string>>(new Set());
  const launchStartTimesRef = useRef<Map<string, number>>(new Map());
  const t = useCallback((key: string, fallback: string, vars?: Record<string, string | number>) => {
    return translate(normalizeLocale(settings.locale), key, fallback, vars);
  }, [settings.locale]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);

    return () => {
      clearTimeout(timer);
    };
  }, [searchQuery]);

  const collectCategoryIds = useCallback((targetId: number): Set<number> => {
    const ids = new Set<number>();

    const walk = (nodes: CategoryNode[]): boolean => {
      for (const node of nodes) {
        if (node.id === targetId) {
          const collectChildren = (current: CategoryNode) => {
            ids.add(current.id);
            current.children.forEach(collectChildren);
          };
          collectChildren(node);
          return true;
        }

        if (walk(node.children)) {
          return true;
        }
      }

      return false;
    };

    walk(categories);
    if (ids.size === 0) {
      ids.add(targetId);
    }
    return ids;
  }, [categories]);

  const refreshDiscover = useCallback(async () => {
    const requestId = ++discoverRequestIdRef.current;

    try {
      const selectedCategoryIds = selectedCategoryId !== undefined
        ? collectCategoryIds(selectedCategoryId)
        : undefined;

      if (debouncedSearchQuery.trim().length >= 2) {
        const paged = await freshService.searchModsPage({ query: debouncedSearchQuery, page: discoverPage, perPage: discoverPerPage, order: searchOrder, fields: searchFields });
        const results = paged.records;
        const filtered = selectedCategoryIds
          ? results.filter((mod) => selectedCategoryIds.has(mod.rootCategory?.id ?? -1))
          : results;

        if (requestId !== discoverRequestIdRef.current) {
          return;
        }

        setDiscoverMods(filtered);
        setHasMoreDiscover(paged.metadata.isComplete === false);
        return;
      }

      if (selectedCategoryId === undefined) {
        // No search, no category — use Subfeed (Ripe / New / Updated)
        // Subfeed returns up to ~15 items/page regardless of perPage, so check mods.length > 0
        const paged = await freshService.getSubfeedPage({
          sort: subfeedSort,
          page: discoverPage,
          perPage: discoverPerPage,
        });
        const mods = paged.records;

        if (requestId !== discoverRequestIdRef.current) {
          return;
        }

        setDiscoverMods(mods);
        setHasMoreDiscover(paged.metadata.isComplete === false);
        return;
      }

      // Category selected — use Mod/Index with user-chosen sort
      const paged = await freshService.listModsPage({
        categoryId: selectedCategoryId,
        page: discoverPage,
        perPage: discoverPerPage,
        sort: categorySort,
        releaseType: browseReleaseType,
        contentRatings: browseContentRatings.length > 0 ? browseContentRatings : undefined,
      });
      const mods = paged.records;

      if (requestId !== discoverRequestIdRef.current) {
        return;
      }

      setDiscoverMods(mods);
      setHasMoreDiscover(paged.metadata.isComplete === false);
    } catch {
      if (requestId !== discoverRequestIdRef.current) {
        return;
      }

      setDiscoverMods([]);
      setHasMoreDiscover(false);
    }
  }, [debouncedSearchQuery, searchOrder, searchFields, selectedCategoryId, subfeedSort, categorySort, discoverPage, browseReleaseType, browseContentRatings, collectCategoryIds]);

  const refreshModUpdates = useCallback(async () => {
    const updates = await freshService.refreshModUpdates();
    setModUpdates(updates);
    setInstalledMods(freshService.getInstalledMods());
  }, []);

  const checkAppUpdate = useCallback(async () => {
    setAppUpdateChecking(true);
    setAppUpdateError(undefined);
    try {
      const result = await freshService.checkAppUpdate();
      setAppUpdate(result);
    } catch (error) {
      setAppUpdateError(error instanceof Error ? error.message : "Failed to check app updates");
    } finally {
      setAppUpdateChecking(false);
    }
  }, []);

  const openAppUpdateDownload = useCallback(async () => {
    if (!appUpdate?.available) {
      throw new Error("No app update is currently available");
    }

    const targetUrl = appUpdate.downloadUrl || appUpdate.releaseUrl;
    await freshService.openExternalUrl(targetUrl);
  }, [appUpdate]);

  const downloadAppUpdate = useCallback(async () => {
    await freshService.downloadAppUpdate();
  }, []);

  const installAppUpdate = useCallback(async () => {
    await freshService.installAppUpdate();
  }, []);

  const getModProfile = useCallback((modId: number) => freshService.getModProfile(modId), []);

  const listModsBySubmitter = useCallback((input: { submitterId: number; categoryId?: number; page?: number; perPage?: number }) => (
    freshService.listMods({
      submitterId: input.submitterId,
      categoryId: input.categoryId,
      page: input.page,
      perPage: input.perPage,
    })
  ), []);

  const handleDeepLink = useCallback(async (rawUrl: string) => {
    const normalizedUrl = rawUrl.trim();
    if (!normalizedUrl) {
      return;
    }

    const now = Date.now();
    for (const [url, seenAt] of processedDeepLinksRef.current.entries()) {
      if (now - seenAt > 60_000) {
        processedDeepLinksRef.current.delete(url);
      }
    }

    const lastProcessedAt = processedDeepLinksRef.current.get(normalizedUrl) ?? 0;
    if (now - lastProcessedAt < 3_000 || processingDeepLinksRef.current.has(normalizedUrl)) {
      return;
    }

    processingDeepLinksRef.current.add(normalizedUrl);

    try {
      if (!/^(fresh|fresh):/i.test(normalizedUrl)) {
        return;
      }

      const parsedDeepLink = parseFreshDeepLink(normalizedUrl);

      if (parsedDeepLink.kind === "pair") {
        const nextSettings = await freshService.updateSettings({
          gameBananaIntegration: {
            ...settings.gameBananaIntegration,
            memberId: parsedDeepLink.memberId,
            secretKey: parsedDeepLink.secretKey,
            pairedAt: Date.now(),
            lastPairUrl: normalizedUrl,
          },
        });
        setSettings(nextSettings);
        processedDeepLinksRef.current.set(normalizedUrl, Date.now());
        toast.success(t("provider.pairingReceived", "GameBanana pairing link received. Remote installs are now linked to this profile."));
        return;
      }

      const selectedEngineFromLink = parsedDeepLink.engine
        ? installedEngines.find((engine) => (
          engine.id.toLowerCase() === parsedDeepLink.engine
          || engine.slug.toLowerCase() === parsedDeepLink.engine
          || engine.name.toLowerCase().replace(/\s+/g, "-") === parsedDeepLink.engine
        ))
        : undefined;

      if (parsedDeepLink.engine && !selectedEngineFromLink) {
        throw new Error(`Engine '${parsedDeepLink.engine}' is not installed`);
      }

      if (parsedDeepLink.archiveUrl && !/^https?:\/\//i.test(parsedDeepLink.archiveUrl)) {
        throw new Error("Install URL must be http/https");
      }

      const profile = await freshService.getModProfile(parsedDeepLink.modId);
      if (profile.files.length === 0) {
        throw new Error("No downloadable files found for this mod");
      }

      const fileIdFromUrl = parsedDeepLink.archiveUrl?.match(/\/dl\/(\d+)/i);
      const selectedFileId = parsedDeepLink.fileId
        || (fileIdFromUrl ? Number(fileIdFromUrl[1]) : profile.files[0].id);

      if (!Number.isFinite(selectedFileId) || selectedFileId <= 0) {
        throw new Error("No valid file id found in deep link or mod profile");
      }

      if (!profile.files.some((file) => file.id === selectedFileId)) {
        throw new Error(`File ${selectedFileId} is not available for mod ${parsedDeepLink.modId}`);
      }

      const selectedFile = profile.files.find((file) => file.id === selectedFileId) ?? profile.files[0];
      if (!selectedFile) {
        throw new Error("No downloadable files found for this mod");
      }

      // Check the archive's raw file list for executables — best-effort, non-blocking on failure
      const rawFileList = await freshService.getRawFileList(selectedFileId);
      const hasExe = rawFileList.some((f) => /\.(exe|msi|bat|cmd|ps1|sh|appimage|dmg|pkg)$/i.test(f));
      if (settings.compatibilityChecks && hasExe) {
        const exeFiles = rawFileList.filter((f) => /\.(exe|msi|bat|cmd|ps1|sh|appimage|dmg|pkg)$/i.test(f));
        const proceed = window.confirm(
          `⚠️ This archive contains executable file(s):\n\n${exeFiles.slice(0, 5).join("\n")}${exeFiles.length > 5 ? `\n…and ${exeFiles.length - 5} more` : ""}\n\nOnly install mods from sources you trust.\n\nContinue installing "${profile.name}"?`,
        );
        if (!proceed) return;
      }

      const defaultEngine = installedEngines.find((engine) => engine.isDefault) ?? installedEngines[0];
      const inferredEngineSlug = modInstallerService.detectRequiredEngine(profile);
      const inferredEngines = inferredEngineSlug
        ? installedEngines.filter((engine) => engine.slug === inferredEngineSlug)
        : [];

      let selectedEngineId = selectedEngineFromLink?.id;
      const previewPlan = modInstallerService.createInstallPlan({
        mod: profile,
        file: selectedFile,
        selectedEngine: selectedEngineFromLink,
      });

      if (previewPlan.type === "standard_mod") {
        if (installedEngines.length === 0) {
          throw new Error("No engine installed. Install an engine first.");
        }

        if (!selectedEngineId) {
          if (inferredEngines.length === 1) {
            selectedEngineId = inferredEngines[0].id;
          } else if (installedEngines.length === 1 && defaultEngine) {
            if (settings.compatibilityChecks) {
              const continueWithDefault = window.confirm(
                `Could not auto-detect a required engine for ${profile.name}. Use ${defaultEngine.name} (${defaultEngine.slug})?`,
              );
              if (!continueWithDefault) {
                return;
              }
            }
            selectedEngineId = defaultEngine.id;
          } else {
            const suggestedEngine = inferredEngines[0] ?? defaultEngine;
            const warningLine = inferredEngineSlug
              ? `Detected engine hint: ${inferredEngineSlug}. Confirm target before installing.`
              : "Could not auto-detect required engine. Choose a target engine before installing.";
            if (!suggestedEngine) {
              throw new Error("No target engine selected. Install cancelled.");
            }

            if (settings.compatibilityChecks) {
              const continueWithSuggested = window.confirm([
                warningLine,
                "",
                `Use suggested engine: ${suggestedEngine.name} (${suggestedEngine.slug})?`,
                "Select Cancel to stop this install and choose an engine manually from the app.",
              ].join("\n"));
              if (!continueWithSuggested) {
                return;
              }
            }

            selectedEngineId = suggestedEngine.id;
          }
        }
      } else {
        selectedEngineId = undefined;
      }

      freshService.queueProtocolInstall({
        modId: parsedDeepLink.modId,
        fileId: selectedFileId,
        downloadUrl: parsedDeepLink.archiveUrl || undefined,
        selectedEngineId,
        priority: 20,
      });
      processedDeepLinksRef.current.set(normalizedUrl, Date.now());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("provider.failedProcessDeepLink", "Failed to process deep link"));
    } finally {
      processingDeepLinksRef.current.delete(normalizedUrl);
    }
  }, [installedEngines, settings.gameBananaIntegration, settings.compatibilityChecks]);

  const refreshAll = useCallback(async () => {
    setLoading(true);

    try {
      const [bestOf, categoryTree, catalog] = await Promise.all([
        freshService.getTrendingMods(),
        freshService.getFreshCategories(),
        freshService.getEngineCatalog(),
        freshService.syncDesktopSettings(),
      ]);

      setBestOfMods(bestOf);
      setCategories(categoryTree);
      setEnginesCatalog(catalog);
      setInstalledMods(freshService.getInstalledMods());
      setInstalledEngines(freshService.getInstalledEngines());
      await freshService.reconcileDiskState();
      setInstalledMods(freshService.getInstalledMods());
      setInstalledEngines(freshService.getInstalledEngines());
      setSettings(freshService.getSettings());
      setItchAuth(await freshService.getItchAuthStatus());
      await freshService.refreshEngineHealth();
      await freshService.hydrateInstalledModMetadata();
      setInstalledMods(freshService.getInstalledMods());
      await refreshModUpdates();
    } finally {
      setLoading(false);
    }
  }, [refreshModUpdates]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    const unsubscribe = freshService.subscribeDownloads((tasks) => {
      setDownloads(tasks);
      setInstalledMods(freshService.getInstalledMods());
      setModUpdates(freshService.getModUpdates());
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    refreshDiscover();
  }, [refreshDiscover]);

  useEffect(() => {
    setDiscoverPage(1);
  }, [selectedCategoryId, subfeedSort, categorySort, debouncedSearchQuery, searchOrder, searchFields, browseReleaseType, browseContentRatings]);

  useEffect(() => {
    if (!window.freshDesktop?.onDeepLink || !window.freshDesktop?.getPendingDeepLinks) {
      return;
    }

    let cancelled = false;
    window.freshDesktop.getPendingDeepLinks()
      .then((payload) => {
        if (cancelled) {
          return;
        }
        for (const rawUrl of payload.links || []) {
          handleDeepLink(rawUrl);
        }
      })
      .catch(() => undefined);

    const unsubscribe = window.freshDesktop.onDeepLink((payload) => {
      if (!cancelled && payload?.url) {
        handleDeepLink(payload.url);
      }
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [handleDeepLink]);

  useEffect(() => {
    if (!window.freshDesktop?.onAppUpdateStatus) {
      return;
    }

    const unsubscribe = window.freshDesktop.onAppUpdateStatus((payload) => {
      setAppUpdateStatus(payload);
      if (payload.info) {
        setAppUpdate(payload.info);
      }
      if (payload.status === "error") {
        setAppUpdateError(payload.message || t("updates.autoUpdaterError", "App update failed"));
      }
    });

    return () => {
      unsubscribe?.();
    };
  }, [t]);

  useEffect(() => {
    if (startupUpdateCheckedRef.current) {
      return;
    }
    if (!settings.checkAppUpdatesOnStartup) {
      startupUpdateCheckedRef.current = true;
      return;
    }

    startupUpdateCheckedRef.current = true;
    setAppUpdateChecking(true);
    setAppUpdateError(undefined);
    freshService.checkAppUpdate()
      .then(async (latest) => {
        setAppUpdate(latest);
        if (latest.available && settings.autoDownloadAppUpdates) {
          if (window.freshDesktop?.downloadAppUpdate) {
            try {
              await freshService.downloadAppUpdate();
            } catch {
              await freshService.openExternalUrl(latest.downloadUrl || latest.releaseUrl);
            }
          } else {
            await freshService.openExternalUrl(latest.downloadUrl || latest.releaseUrl);
          }
        }
      })
      .catch((error) => {
        setAppUpdateError(error instanceof Error ? error.message : "Failed to check app updates");
      })
      .finally(() => {
        setAppUpdateChecking(false);
      });
  }, [settings.autoDownloadAppUpdates, settings.checkAppUpdatesOnStartup]);

  useEffect(() => {
    if (!window.freshDesktop?.getRunningLaunches || !window.freshDesktop?.onLaunchExit) {
      return;
    }

    window.freshDesktop.getRunningLaunches()
      .then(({ launches }) => {
        const ids = new Set(launches.map((l) => l.launchId));
        for (const l of launches) {
          launchStartTimesRef.current.set(l.launchId, l.startTime);
        }
        setRunningLaunchIds(ids);
      })
      .catch(() => undefined);

      const unsubscribe = window.freshDesktop.onLaunchExit(({ launchId }) => {
      launchStartTimesRef.current.delete(launchId);
      setRunningLaunchIds((prev) => {
        const next = new Set(prev);
        next.delete(launchId);
        return next;
      });
    });

    return unsubscribe;
  }, []);

  const value = useMemo<FreshContextValue>(
    () => ({
      loading,
      bestOfMods,
      discoverMods,
      categories,
      installedMods,
      modUpdates,
      downloads,
      enginesCatalog,
      installedEngines,
      settings,
      itchAuth,
      selectedCategoryId,
      setSelectedCategoryId,
      subfeedSort,
      setSubfeedSort,
      categorySort,
      setCategorySort,
      discoverPage,
      setDiscoverPage,
      discoverPerPage,
      hasMoreDiscover,
      searchQuery,
      setSearchQuery,
      searchOrder,
      setSearchOrder,
      searchFields,
      setSearchFields,
      browseReleaseType,
      setBrowseReleaseType,
      browseContentRatings,
      setBrowseContentRatings,
      refreshDiscover,
      refreshModUpdates,
      getModProfile,
      listModsBySubmitter,
      installMod: (modId, fileId, selectedEngineId, priority = 0, options) => {
        try {
          freshService.queueInstall(modId, fileId, selectedEngineId, priority, options);
          toast.success(t("provider.installQueued", "Install queued — check Downloads for progress."));
          return { ok: true };
        } catch (error) {
          const message = error instanceof Error ? error.message : t("provider.unableQueueInstall", "Unable to queue install");
          toast.error(message);
          return { ok: false, error: message };
        }
      },
      installEngine: async (slug, downloadUrl, version, options) => {
        await freshService.installEngineFromRelease({
          slug,
          releaseUrl: downloadUrl,
          releaseVersion: version,
          allowMissingExecutable: options?.allowMissingExecutable,
        });
        setInstalledEngines(freshService.getInstalledEngines());
      },
      importEngineFromFolder: async (slug, versionHint, sourcePath, customName) => {
        await freshService.importEngineFromFolder({ slug, versionHint, sourcePath, customName });
        setInstalledEngines(freshService.getInstalledEngines());
      },
      updateEngine: async (engineId) => {
        await freshService.updateEngine(engineId);
        setInstalledEngines(freshService.getInstalledEngines());
      },
      uninstallEngine: async (engineId) => {
        await freshService.uninstallEngine(engineId);
        setInstalledEngines(freshService.getInstalledEngines());
      },
      launchEngine: async (engineId, options) => {
        launchStartTimesRef.current.set(engineId, Date.now());
        await freshService.launchEngine(engineId, options);
        setRunningLaunchIds((prev) => { const next = new Set(prev); next.add(engineId); return next; });
      },
      openEngineFolder: async (engineId) => {
        await freshService.openEngineFolder(engineId);
      },
      openEngineModsFolder: async (engineId) => {
        await freshService.openEngineModsFolder(engineId);
      },
      getEngineHealth: (engineId) => freshService.getEngineHealth(engineId),
      refreshEngineHealth: async (engineId) => {
        await freshService.refreshEngineHealth(engineId);
        setInstalledEngines(freshService.getInstalledEngines());
      },
      launchInstalledMod: async (installedId) => {
        const startTime = Date.now();
        launchStartTimesRef.current.set(installedId, startTime);
        await freshService.launchInstalledMod(installedId);
        setInstalledMods(freshService.getInstalledMods());
        setRunningLaunchIds((prev) => { const next = new Set(prev); next.add(installedId); return next; });
      },
      updateInstalledModLaunchOptions: async (installedId, options) => {
        await freshService.updateInstalledModLaunchOptions(installedId, options);
        setInstalledMods(freshService.getInstalledMods());
      },
      cancelDownload: (taskId) => {
        freshService.cancelDownload(taskId);
      },
      retryDownload: (taskId) => {
        freshService.retryDownload(taskId);
      },
      clearDownloads: () => {
        freshService.clearDownloadHistory();
        setDownloads(freshService.getDownloadHistory());
      },
      renameEngine: (engineId, name) => {
        freshService.renameEngine(engineId, name);
        setInstalledEngines(freshService.getInstalledEngines());
      },
      setEngineCustomIcon: (engineId, iconUrl) => {
        freshService.setEngineCustomIcon(engineId, iconUrl);
        setInstalledEngines(freshService.getInstalledEngines());
      },
      setModCustomImage: (installedId, imageUrl) => {
        freshService.setModCustomImage(installedId, imageUrl);
        setInstalledMods(freshService.getInstalledMods());
      },
      setModEnabled: (installedId, enabled) => {
        freshService.setModEnabled(installedId, enabled);
        setInstalledMods(freshService.getInstalledMods());
      },
      setModTags: (installedId, tags) => {
        freshService.setModTags(installedId, tags);
        setInstalledMods(freshService.getInstalledMods());
      },
      setModPinned: (installedId, pinned) => {
        freshService.setModPinned(installedId, pinned);
        setInstalledMods(freshService.getInstalledMods());
      },
      setModNotes: (installedId, notes) => {
        freshService.setModNotes(installedId, notes);
        setInstalledMods(freshService.getInstalledMods());
      },
      renameInstalledMod: (installedId, newName) => {
        freshService.renameInstalledMod(installedId, newName);
        setInstalledMods(freshService.getInstalledMods());
      },
      openExternalUrl: async (url) => {
        await freshService.openExternalUrl(url);
      },
      setDefaultEngine: (engineId) => {
        freshService.setDefaultEngine(engineId);
        setInstalledEngines(freshService.getInstalledEngines());
      },
      removeInstalledMod: async (installedId, options) => {
        await freshService.removeInstalledMod(installedId, options);
        setInstalledMods(freshService.getInstalledMods());
      },
      updateSettings: async (patch) => {
        const next = await freshService.updateSettings(patch);
        setSettings(next);
      },
      browseFolder: async (options) => freshService.pickFolder(options),
      browseFile: async (options) => freshService.pickFile(options),
      openFolderPath: async (targetPath) => {
        await freshService.openAnyPath(targetPath);
      },
      addManualMod: async (input) => {
        await freshService.addManualModFromFolder(input);
        setInstalledMods(freshService.getInstalledMods());
      },
      autodetectInstalledMods: async () => {
        const added = await freshService.scanInstalledEngineModFolders();
        setInstalledMods(freshService.getInstalledMods());
        return added;
      },
      reconcileDiskState: async () => {
        await freshService.reconcileDiskState();
        setInstalledMods(freshService.getInstalledMods());
        setInstalledEngines(freshService.getInstalledEngines());
      },
      connectItch: async (clientId) => {
        await freshService.connectItchOAuth(clientId);
        setItchAuth(await freshService.getItchAuthStatus());
      },
      disconnectItch: async () => {
        await freshService.disconnectItchOAuth();
        setItchAuth(await freshService.getItchAuthStatus());
      },
      refreshItchAuth: async () => {
        setItchAuth(await freshService.getItchAuthStatus());
      },
      appUpdate,
      appUpdateError,
      appUpdateChecking,
      checkAppUpdate,
      openAppUpdateDownload,
      downloadAppUpdate,
      installAppUpdate,
      appUpdateStatus,
      runningLaunchIds,
      killLaunch: async (launchId) => {
        await window.freshDesktop?.killLaunch?.({ launchId });
        setRunningLaunchIds((prev) => { const next = new Set(prev); next.delete(launchId); return next; });
      },
      detectWineRuntimes: async () => {
        const result = await window.freshDesktop?.detectWineRuntimes?.();
        return result?.runtimes ?? [];
      },
      scanCommonEnginePaths: async () => {
        const result = await window.freshDesktop?.scanCommonEnginePaths?.();
        return result?.paths ?? [];
      },
      clearAllData: async () => {
        freshStorageService.clearAllData();
        setInstalledMods([]);
        setInstalledEngines([]);
        setDownloads([]);
        setSettings(DEFAULT_SETTINGS);
        window.location.reload();
      },
      clearAllMods: async () => {
        freshStorageService.clearMods();
        setInstalledMods([]);
      },
      clearAllEngines: async () => {
        freshStorageService.clearEngines();
        setInstalledEngines([]);
      },
      clearAllDownloads: async () => {
        freshStorageService.clearDownloads();
        setDownloads([]);
      },
      resetSettings: async () => {
        freshStorageService.clearSettings();
        setSettings(DEFAULT_SETTINGS);
      },
      clearTheme: async () => {
        freshStorageService.clearTheme();
      },
      clearCompletedDownloads: async () => {
        freshStorageService.clearDownloadsByStatus("completed");
        setDownloads(freshService.getDownloadHistory());
      },
      clearFailedDownloads: async () => {
        freshStorageService.clearDownloadsByStatus("failed");
        setDownloads(freshService.getDownloadHistory());
      },
      clearActiveDownloads: async () => {
        freshStorageService.clearDownloadsByStatus("active");
        setDownloads(freshService.getDownloadHistory());
      },
      clearDisabledMods: async () => {
        freshStorageService.clearDisabledMods();
        setInstalledMods(freshStorageService.getInstalledMods());
      },
      clearUnpinnedMods: async () => {
        freshStorageService.clearUnpinnedMods();
        setInstalledMods(freshStorageService.getInstalledMods());
      },
    }),
    [
      loading,
      bestOfMods,
      discoverMods,
      categories,
      installedMods,
      modUpdates,
      downloads,
      enginesCatalog,
      installedEngines,
      settings,
      itchAuth,
      appUpdate,
      appUpdateError,
      appUpdateChecking,
      appUpdateStatus,
      selectedCategoryId,
      subfeedSort,
      categorySort,
      discoverPage,
      discoverPerPage,
      hasMoreDiscover,
      searchQuery,
      searchOrder,
      searchFields,
      browseReleaseType,
      browseContentRatings,
      refreshDiscover,
      refreshModUpdates,
      checkAppUpdate,
      openAppUpdateDownload,
      downloadAppUpdate,
      installAppUpdate,
      getModProfile,
      listModsBySubmitter,
      runningLaunchIds,
    ],
  );

  return <FreshContext.Provider value={value}>{children}</FreshContext.Provider>;
}

export function useFresh() {
  const context = useContext(FreshContext);
  if (!context) {
    throw new Error("useFresh must be used within FreshProvider");
  }
  return context;
}



