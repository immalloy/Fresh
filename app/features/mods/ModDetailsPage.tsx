import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import DOMPurify from "dompurify";
import { useNavigate, useParams } from "react-router";
import {
  ArrowLeft,
  CalendarPlus2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  ExternalLink,
  Eye,
  FileArchive,
  FolderCog,
  HandHeart,
  Heart,
  MessageCircle,
  Play,
  RefreshCw,
  ShieldCheck,
  Tag,
  User,
  Users,
  Wrench,
} from "lucide-react";
import { useFresh, useI18n } from "../../providers";
import { detectRequiredEngineFromCategories } from "../../services/fresh";
import type { GameBananaModProfile } from "../../services/fresh";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../shared/ui/dialog";

function formatCompact(value?: number): string {
  if (!value || value <= 0) return "0";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function formatDate(ts?: number, unknown = "—"): string {
  if (!ts) return unknown;
  return new Date(ts * 1000).toLocaleDateString();
}

function formatRelativeTime(ts?: number): string {
  if (!ts) return "—";
  const diff = Date.now() - ts * 1000;
  if (diff < 60_000) return "now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  if (diff < 2_592_000_000) return `${Math.floor(diff / 86_400_000)}d`;
  if (diff < 31_536_000_000) return `${Math.floor(diff / 2_592_000_000)}mo`;
  return `${Math.floor(diff / 31_536_000_000)}y`;
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function extractYoutubeEmbedUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("youtube.com")) {
      if (parsed.pathname === "/watch") {
        const id = parsed.searchParams.get("v");
        if (id) return `https://www.youtube.com/embed/${id}`;
      }
      if (parsed.pathname.startsWith("/embed/")) return url;
    }
    if (parsed.hostname === "youtu.be") {
      const id = parsed.pathname.replace("/", "").trim();
      if (id) return `https://www.youtube.com/embed/${id}`;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function toSafeHttpUrl(url?: string, baseUrl = "https://gamebanana.com"): string | undefined {
  if (!url?.trim()) {
    return undefined;
  }

  try {
    const parsed = new URL(url, baseUrl);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function sanitizeRichHtml(input?: string): string {
  if (!input?.trim() || typeof document === "undefined") {
    return "";
  }

  const fragment = DOMPurify.sanitize(input, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["style", "script", "iframe", "object", "embed", "form", "input", "button", "textarea", "select"],
    FORBID_ATTR: ["style"],
    ALLOW_DATA_ATTR: false,
    RETURN_DOM_FRAGMENT: true,
  }) as DocumentFragment;

  const container = document.createElement("div");
  container.append(fragment);

  const anchorNodes = container.querySelectorAll<HTMLAnchorElement>("a[href]");
  anchorNodes.forEach((node) => {
    const safeHref = toSafeHttpUrl(node.getAttribute("href") ?? undefined);
    if (!safeHref) {
      node.removeAttribute("href");
      return;
    }
    node.setAttribute("href", safeHref);
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer nofollow ugc");
  });

  const mediaNodes = container.querySelectorAll<HTMLElement>("img[src], source[src], video[src], audio[src]");
  mediaNodes.forEach((node) => {
    const attr = node.getAttribute("src") ?? undefined;
    const safeSrc = toSafeHttpUrl(attr);
    if (!safeSrc) {
      node.remove();
      return;
    }
    node.setAttribute("src", safeSrc);
  });

  return container.innerHTML;
}

function toAbsoluteUrl(url?: string): string | undefined {
  return toSafeHttpUrl(url);
}

function extractYoutubeThumbnail(embedUrl: string): string | undefined {
  const match = embedUrl.match(/\/embed\/([^?&]+)/i);
  const videoId = match?.[1]?.trim();
  if (!videoId) {
    return undefined;
  }
  return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
}

function mirrorProviderLabel(provider?: string): string {
  switch (provider) {
    case "google_drive":
      return "Google Drive";
    case "mediafire":
      return "MediaFire";
    case "gamebanana":
      return "GameBanana";
    case "direct":
      return "Direct link";
    default:
      return "Mirror";
  }
}

function supportsMirrorInstall(url: string): boolean {
  const normalized = url.toLowerCase();
  if (normalized.includes("gamebanana.com/dl/")) {
    return true;
  }
  if (normalized.includes("drive.google.com") || normalized.includes("mediafire.com")) {
    return true;
  }
  return /\.(zip|rar|7z|tar|gz|bz2)([?#].*)?$/i.test(normalized);
}

const FNF_LOADING_MESSAGES = [
  "Loading the beats...",
  "Warming up the crew...",
  "Reading the charts...",
  "Checking the tracklist...",
  "Getting the stage ready...",
  "Waking up Boyfriend...",
  "Tuning the microphone...",
];

export function ModDetailsPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const params = useParams();
  const modId = Number(params.modId);
  const {
    getModProfile,
    installMod,
    installedEngines,
    openExternalUrl,
  } = useFresh();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<GameBananaModProfile | null>(null);
  const [activeMediaIndex, setActiveMediaIndex] = useState(0);
  const [installDialogOpen, setInstallDialogOpen] = useState(false);
  const [installChoice, setInstallChoice] = useState<"executable" | "mod_folder" | null>(null);
  const [selectedEngineId, setSelectedEngineId] = useState<string>("");
  const [installError, setInstallError] = useState<string | null>(null);
  const [installTarget, setInstallTarget] = useState<{ fileId: number; downloadUrlOverride?: string; sourceLabel?: string } | null>(null);
  const [loadingMsgIndex] = useState(() => Math.floor(Math.random() * FNF_LOADING_MESSAGES.length));

  useEffect(() => {
    if (!Number.isFinite(modId) || modId <= 0) {
      setError(t("mod.invalidId", "Invalid mod id"));
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    getModProfile(modId)
      .then((next) => {
        if (cancelled) return;
        setProfile(next);
        setActiveMediaIndex(0);
        const detectedSlug = detectRequiredEngineFromCategories(next) ?? next.requiredEngine;
        const matching = detectedSlug
          ? installedEngines.find((engine) => engine.slug === detectedSlug)
          : undefined;
        const fallback = installedEngines.find((engine) => engine.isDefault) ?? installedEngines[0];
        setSelectedEngineId((matching ?? fallback)?.id ?? "");
        setInstallChoice(null);
        setInstallTarget(null);
        setInstallDialogOpen(false);
        setInstallError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : t("mod.failedLoadProfile", "Failed to load mod profile"));
        setProfile(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [modId, getModProfile, installedEngines, t]);

  type MediaItem = { type: "image"; url: string } | { type: "video"; embedUrl: string; thumbnailUrl?: string };
  const mediaGallery = useMemo((): MediaItem[] => {
    if (!profile) return [];
    const videos: MediaItem[] = [];
    const images: MediaItem[] = [];
    const seen = new Set<string>();
    const addImage = (url: string | undefined) => {
      if (!url || seen.has(url)) {
        return;
      }
      seen.add(url);
      images.push({ type: "image", url });
    };

    (profile.embeddedMedia ?? [])
      .map((url) => extractYoutubeEmbedUrl(url))
      .filter((url): url is string => Boolean(url))
      .forEach((embedUrl) => {
        if (embedUrl && !seen.has(embedUrl)) {
          seen.add(embedUrl);
          videos.push({ type: "video", embedUrl, thumbnailUrl: extractYoutubeThumbnail(embedUrl) });
        }
      });

    if (profile.imageUrl) {
      addImage(profile.imageUrl);
    } else if (profile.thumbnailUrl) {
      addImage(profile.thumbnailUrl);
    }
    profile.screenshotUrls?.forEach(addImage);

    return [...videos, ...images];
  }, [profile]);
  const getCurrentItem = (index: number): MediaItem | undefined => mediaGallery[Math.min(index, mediaGallery.length - 1)];
  const currentMedia = getCurrentItem(activeMediaIndex);

  const categoryBreadcrumb = profile
    ? [profile.superCategory, profile.rootCategory, profile.category].filter(
        (c, i, arr) => c?.name && arr.findIndex((x) => x?.name === c.name) === i,
      )
    : [];

  const detectedEngineSlug = profile
    ? (detectRequiredEngineFromCategories(profile) ?? profile.requiredEngine)
    : undefined;
  const selectedEngine = installedEngines.find((engine) => engine.id === selectedEngineId);
  const detectedEngineInstalled = detectedEngineSlug
    ? installedEngines.find((engine) => engine.slug === detectedEngineSlug)
    : undefined;

  const hasDependencyWarning = Boolean(
    detectedEngineSlug && selectedEngine && selectedEngine.slug !== detectedEngineSlug,
  );

  const richDescriptionHtml = useMemo(() => sanitizeRichHtml(profile?.text ?? ""), [profile?.text]);

  const hasInstallableEngine = installedEngines.length > 0;

  const beginInstallForFile = (fileId: number) => {
    setInstallTarget({ fileId });
    setInstallChoice(null);
    setInstallError(null);
    setInstallDialogOpen(true);
  };

  const beginInstallForMirror = (mirror: { fileId?: number; url: string; description?: string; provider?: string }) => {
    const safeMirrorUrl = toSafeHttpUrl(mirror.url);
    if (!safeMirrorUrl) {
      setInstallError(t("mod.invalidExternalUrl", "This link is not a valid HTTP/HTTPS URL."));
      return;
    }

    const fallbackFileId = mirror.fileId ?? profile?.files[0]?.id;
    if (!fallbackFileId) {
      void openExternalUrl(safeMirrorUrl);
      return;
    }

    setInstallTarget({
      fileId: fallbackFileId,
      downloadUrlOverride: safeMirrorUrl,
      sourceLabel: mirror.description ?? mirrorProviderLabel(mirror.provider),
    });
    setInstallChoice(null);
    setInstallError(null);
    setInstallDialogOpen(true);
  };

  const submitInstall = (choice: "executable" | "mod_folder") => {
    if (!profile || !installTarget) {
      setInstallError(t("mod.installSelectionMissing", "Select a package to install."));
      return;
    }

    if (choice === "mod_folder" && !hasInstallableEngine) {
      setInstallError(t("mod.noEnginesInstalled", "No engines installed. Install an engine first or switch install mode to executable package."));
      return;
    }

    try {
      const result = installMod(
        profile.id,
        installTarget.fileId,
        choice === "mod_folder" ? (selectedEngineId || undefined) : undefined,
        0,
        {
          forceInstallType: choice === "executable" ? "executable" : "standard_mod",
          downloadUrlOverride: installTarget.downloadUrlOverride,
        },
      );
      if (!result.ok) {
        setInstallError(result.error ?? t("provider.unableQueueInstall", "Unable to queue install"));
        return;
      }
      setInstallDialogOpen(false);
      setInstallChoice(null);
      setInstallError(null);
      setInstallTarget(null);
    } catch (error) {
      setInstallError(error instanceof Error ? error.message : t("provider.unableQueueInstall", "Unable to queue install"));
    }
  };

  return (
    <div className="p-4 md:p-6 lg:p-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => {
            if (window.history.length > 1) {
              navigate(-1);
            } else {
              navigate("/discover");
            }
          }}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm hover:bg-secondary"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("mod.backToBrowse", "Back to browse")}
        </button>

        {profile?.profileUrl && (
          <button
            type="button"
            onClick={() => {
              const externalUrl = toAbsoluteUrl(profile.profileUrl);
              if (externalUrl) {
                void openExternalUrl(externalUrl);
              }
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm hover:bg-secondary"
          >
            <ExternalLink className="h-4 w-4" />
            {t("mod.openOnGameBanana", "Open on GameBanana")}
          </button>
        )}
      </div>

      {loading && (
        <div className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground inline-flex items-center gap-2">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}
            className="h-4 w-4 rounded-full border-2 border-primary/30 border-t-primary"
          />
          {FNF_LOADING_MESSAGES[loadingMsgIndex]}
        </div>
      )}

      {!loading && error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {!loading && !error && profile && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-border bg-card p-4 md:p-5">
            <h1 className="text-2xl font-bold text-foreground md:text-3xl">{profile.name}</h1>
            {profile.description && <p className="mt-2 text-sm text-muted-foreground">{profile.description}</p>}

            {categoryBreadcrumb.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <Tag className="h-3.5 w-3.5" />
                {categoryBreadcrumb.map((cat, i) => (
                  <span key={cat!.id ?? `${cat!.name}-${i}`} className="inline-flex items-center gap-1">
                    {i > 0 && <ChevronRight className="h-3 w-3 opacity-60" />}
                    {cat!.iconUrl && <img src={cat!.iconUrl} alt="" className="h-4 w-4 object-contain" loading="lazy" />}
                    <span className={i === categoryBreadcrumb.length - 1 ? "font-medium text-primary" : ""}>{cat!.name}</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(350px,0.85fr)] 2xl:grid-cols-[minmax(0,1.7fr)_380px]">
            <section className="space-y-4">
              {(mediaGallery.length > 0) && (
                <div className="space-y-3 rounded-2xl border border-border bg-card p-3 md:p-4">
                  <div className="overflow-hidden rounded-xl border border-border bg-secondary/30">
                    <div className="relative aspect-video">
                      {currentMedia?.type === "video" ? (
                        <iframe
                          src={currentMedia.embedUrl}
                          title={`YouTube embed ${activeMediaIndex + 1}`}
                          loading="eager"
                          className="h-full w-full"
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                        />
                      ) : (
                        <img
                          src={currentMedia?.type === "image" ? currentMedia.url : ""}
                          alt={profile.name}
                          className="h-full w-full object-cover"
                          loading="eager"
                        />
                      )}
                      {mediaGallery.length > 1 && (
                        <>
                          <button
                            type="button"
                            onClick={() => setActiveMediaIndex((v) => (v - 1 + mediaGallery.length) % mediaGallery.length)}
                            className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-black/65 p-2 text-white hover:bg-black/80"
                            aria-label={t("mod.previousImage", "Previous image")}
                          >
                            <ChevronLeft className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setActiveMediaIndex((v) => (v + 1) % mediaGallery.length)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-black/65 p-2 text-white hover:bg-black/80"
                            aria-label={t("mod.nextImage", "Next image")}
                          >
                            <ChevronRight className="h-4 w-4" />
                          </button>
                        </>
                      )}
                    </div>
                    {mediaGallery.length > 1 && (
                      <div className="flex gap-2 overflow-x-auto border-t border-border/70 p-3">
                        {mediaGallery.map((item, index) => (
                          <button
                            key={`${item.type}-${index}`}
                            type="button"
                            onClick={() => setActiveMediaIndex(index)}
                            className={`h-16 w-24 shrink-0 overflow-hidden rounded border ${index === activeMediaIndex ? "border-primary" : "border-border"}`}
                            aria-label={t("mod.preview", `Preview ${index + 1}`)}
                          >
                            {item.type === "video" ? (
                              <div className="relative h-full w-full">
                                {item.thumbnailUrl && (
                                  <img
                                    src={item.thumbnailUrl}
                                    alt=""
                                    className="h-full w-full object-cover brightness-75"
                                    loading="lazy"
                                  />
                                )}
                                <div className="absolute inset-0 flex items-center justify-center bg-black/35">
                                  <Play className="h-6 w-6 text-white" />
                                </div>
                              </div>
                            ) : (
                              <img src={item.url} alt="" className="h-full w-full object-cover" loading="lazy" />
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {(profile.text || profile.description) && (
                <div className="rounded-2xl border border-border bg-card p-4 md:p-5">
                  <h2 className="mb-3 text-base font-semibold text-foreground">{t("mod.description", "Description")}</h2>
                  {profile.text?.trim()
                    ? (
                      <div
                        className="text-sm leading-7 text-foreground [&_.GreenColor]:text-emerald-300 [&_.RedColor]:text-rose-300 [&_.BlueColor]:text-sky-300 [&_.OrangeColor]:text-orange-300 [&_.YellowColor]:text-amber-300 [&_.WhiteColor]:text-white [&_.GreyColor]:text-zinc-300 [&_.Bold]:font-bold [&_.Italic]:italic [&_a]:text-sky-300 [&_a]:underline [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_img]:my-2 [&_img]:max-w-full [&_img]:rounded-lg [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-5"
                        dangerouslySetInnerHTML={{ __html: richDescriptionHtml }}
                      />
                      )
                    : <p className="text-sm text-muted-foreground">{profile.description}</p>}
                </div>
              )}

              <div className="rounded-2xl border border-border bg-card p-4 md:p-5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-base font-semibold text-foreground">{t("mod.files", "Files")}</h2>
                  <p className="text-xs text-muted-foreground">{t("mod.pickInstallModeOnClick", "Choose install mode after clicking Install")}</p>
                </div>

                {hasDependencyWarning && (
                  <div className="mb-3 rounded-lg border border-warning/25 bg-warning/10 p-2.5 text-xs text-foreground">
                    <p>
                      {t("mod.engineMismatch", "This mod targets")} <span className="font-medium">{detectedEngineSlug}</span>
                      {", "}{t("mod.engineMismatchSelected", "but selected engine is")} <span className="font-medium">{selectedEngine?.slug}</span>.
                    </p>
                    {detectedEngineInstalled && (
                      <button
                        type="button"
                        onClick={() => setSelectedEngineId(detectedEngineInstalled.id)}
                        className="mt-1.5 rounded bg-warning/20 px-2 py-1 font-medium hover:bg-warning/30"
                      >
                        {t("mod.switchToEngine", "Switch to")} {detectedEngineInstalled.name}
                      </button>
                    )}
                  </div>
                )}

                <div className="space-y-3">
                  {profile.files.length === 0 && (
                    <div className="rounded-xl border border-border p-3 text-sm text-muted-foreground">
                      {t("mod.noFiles", "No downloadable files found.")}
                    </div>
                  )}

                  {profile.files.map((file) => (
                    <div key={file.id} className="rounded-xl border border-border bg-secondary/20 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="line-clamp-1 text-sm font-semibold text-foreground">{file.fileName}</p>
                        {file.avResult === "clean" && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                            <ShieldCheck className="h-3.5 w-3.5" /> Clean
                          </span>
                        )}
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                        {file.version && <span className="rounded-full border border-border bg-card px-2 py-0.5 text-foreground">v{file.version}</span>}
                        {file.description && <span className="line-clamp-1 rounded-full border border-border bg-card px-2 py-0.5 text-muted-foreground">{file.description}</span>}
                        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-muted-foreground"><Download className="h-3 w-3" />{formatCompact(file.downloadCount)}</span>
                        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-muted-foreground"><Clock3 className="h-3 w-3" />{formatDate(file.dateAdded)}</span>
                        <span className="rounded-full border border-border bg-card px-2 py-0.5 text-muted-foreground">{formatBytes(file.fileSize)}</span>
                      </div>

                      {file.modManagerIntegrations && file.modManagerIntegrations.length > 0 && (
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                          {file.modManagerIntegrations.map((integration, idx) => (
                            <span key={`${file.id}-integration-${idx}`} className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-muted-foreground">
                              {integration.iconUrl
                                ? <img src={integration.iconUrl} alt="" className="h-3.5 w-3.5 object-contain" loading="lazy" />
                                : <Wrench className="h-3.5 w-3.5" />}
                              {integration.installerName ?? integration.alias ?? "Integration"}
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="mt-3 flex flex-wrap gap-2">
                        <motion.button
                          type="button"
                          onClick={() => beginInstallForFile(file.id)}
                          whileTap={{ scale: 0.95 }}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-primary/90 px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary"
                        >
                          <Download className="h-4 w-4" />
                          {t("mod.install", "Install")}
                        </motion.button>
                      </div>
                    </div>
                  ))}

                  {(profile.alternateFileSources?.length ?? 0) > 0 && (
                    <div className="space-y-2 pt-1">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("mod.mirrors", "Mirrors")}</h3>
                      {profile.alternateFileSources?.map((source, index) => {
                        const provider = mirrorProviderLabel(source.provider);
                        const safeMirrorUrl = toSafeHttpUrl(source.url);
                        const installable = safeMirrorUrl ? supportsMirrorInstall(safeMirrorUrl) : false;
                        return (
                          <div key={`${source.url}-${index}`} className="rounded-xl border border-border bg-secondary/20 p-3">
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <p className="line-clamp-1 text-sm font-medium text-foreground">{source.description ?? provider}</p>
                              <span className="rounded-full border border-border bg-card px-2 py-0.5 text-[10px] text-muted-foreground">{provider}</span>
                            </div>
                            <p className="line-clamp-1 text-xs text-muted-foreground">{source.url}</p>
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              {installable ? (
                                <button
                                  type="button"
                                  onClick={() => beginInstallForMirror(source)}
                                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary/90 px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary"
                                >
                                  <Download className="h-3.5 w-3.5" />
                                  {t("mod.install", "Install")}
                                </button>
                              ) : (
                                <span className="rounded-md border border-border bg-card px-2 py-1 text-[11px] text-muted-foreground">
                                  {t("mod.mirrorInstallUnsupported", "Direct install is not available for this mirror.")}
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={() => {
                                  if (safeMirrorUrl) {
                                    void openExternalUrl(safeMirrorUrl);
                                    return;
                                  }
                                  setInstallError(t("mod.invalidExternalUrl", "This link is not a valid HTTP/HTTPS URL."));
                                }}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs hover:bg-secondary"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                                {t("mod.openInBrowser", "Open in browser")}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </section>

            <aside className="space-y-4">
              <div className="rounded-2xl border border-border bg-card p-4">
                <h2 className="mb-3 text-sm font-semibold text-foreground">{t("mod.stats", "Stats")}</h2>
                <div className="grid grid-cols-2 gap-1.5 text-xs">
                  {[
                    { icon: Heart, label: "Likes", value: formatCompact(profile.likeCount) },
                    { icon: Download, label: "Downloads", value: formatCompact(profile.downloadCount) },
                    { icon: Eye, label: "Views", value: formatCompact(profile.viewCount) },
                    { icon: MessageCircle, label: "Posts", value: formatCompact(profile.postCount) },
                    { icon: CalendarPlus2, label: "Added", value: formatRelativeTime(profile.dateAdded) },
                    { icon: RefreshCw, label: "Updated", value: formatRelativeTime(profile.dateUpdated ?? profile.dateModified) },
                    { icon: HandHeart, label: "Thanks", value: formatCompact(profile.thanksCount) },
                    { icon: Users, label: "Subscribers", value: formatCompact(profile.subscriberCount) },
                  ].map((stat) => (
                    <div key={stat.label} className="flex items-center justify-between gap-1 rounded-lg border border-border bg-secondary/30 px-2 py-1.5">
                      <span className="inline-flex items-center gap-1 text-muted-foreground"><stat.icon className="h-3.5 w-3.5" /> {stat.label}</span>
                      <span className="font-medium text-foreground">{stat.value}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-card p-4">
                <h2 className="mb-3 text-sm font-semibold text-foreground">{t("mod.submitter", "Submitter")}</h2>
                <button
                  type="button"
                  onClick={() => {
                    const submitterUrl = toAbsoluteUrl(profile.submitter?.profileUrl);
                    if (submitterUrl) {
                      void openExternalUrl(submitterUrl);
                    }
                  }}
                  className="inline-flex w-full items-center gap-2 rounded-lg border border-border bg-secondary/30 p-2.5 text-left hover:bg-secondary"
                >
                  {profile.submitter?.avatarUrl
                    ? <img src={profile.submitter.avatarUrl} alt="" className="h-10 w-10 rounded-full object-cover" loading="lazy" />
                    : <User className="h-5 w-5" />}
                  <div className="min-w-0">
                    <p className="line-clamp-1 text-sm font-semibold text-foreground">{profile.submitter?.name ?? "—"}</p>
                    <p className="text-xs text-muted-foreground">{t("mod.openProfile", "Open profile")}</p>
                  </div>
                  <ExternalLink className="ml-auto h-4 w-4 text-muted-foreground" />
                </button>
              </div>

              {profile.credits.length > 0 && (
                <div className="rounded-2xl border border-border bg-card p-4">
                  <h2 className="mb-3 text-sm font-semibold text-foreground">{t("mod.credits", "Credits")}</h2>
                  <div className="space-y-3">
                    {profile.credits.map((group) => (
                      <div key={group.groupName} className="rounded-xl border border-border p-3">
                        <h3 className="mb-2 text-sm font-semibold text-foreground">{group.groupName}</h3>
                        <div className="space-y-2">
                          {group.authors.map((author) => {
                            const authorUrl = toAbsoluteUrl(author.profileUrl);
                            const hasProfile = Boolean(authorUrl);
                            const isGameBananaUser = Boolean(authorUrl?.includes("gamebanana.com/members/"));

                            if (isGameBananaUser) {
                              return (
                                <button
                                  key={`${group.groupName}-${author.id}-${author.name}`}
                                  type="button"
                                  onClick={() => {
                                    if (authorUrl) {
                                      void openExternalUrl(authorUrl);
                                    }
                                  }}
                                  className="inline-flex w-full items-center gap-2 rounded-lg border border-border bg-secondary/25 p-2 text-left hover:bg-secondary"
                                >
                                  {author.avatarUrl
                                    ? <img src={author.avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover" loading="lazy" />
                                    : <User className="h-4 w-4" />}
                                  <div className="min-w-0">
                                    <p className="line-clamp-1 text-xs font-semibold text-foreground">{author.name}</p>
                                    {author.role && <p className="line-clamp-1 text-[11px] text-muted-foreground">{author.role}</p>}
                                  </div>
                                  <ExternalLink className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
                                </button>
                              );
                            }

                            return (
                              <button
                                key={`${group.groupName}-${author.id}-${author.name}`}
                                type="button"
                                onClick={() => {
                                  if (authorUrl) {
                                    void openExternalUrl(authorUrl);
                                  }
                                }}
                                disabled={!hasProfile}
                                className="inline-flex w-full items-center justify-between rounded-lg border border-border bg-secondary/25 px-2.5 py-1.5 text-left text-xs hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                <span className="line-clamp-1 text-foreground">{author.name}</span>
                                <span className="ml-2 text-muted-foreground">{author.role ?? ""}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="rounded-2xl border border-border bg-card p-4">
                <h2 className="mb-3 text-sm font-semibold text-foreground">{t("mod.details", "Details")}</h2>
                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between rounded-lg border border-border bg-secondary/30 px-2.5 py-2"><span className="text-muted-foreground">Version</span><span className="font-medium text-foreground">{profile.version ?? "—"}</span></div>
                  <div className="flex items-center justify-between rounded-lg border border-border bg-secondary/30 px-2.5 py-2"><span className="text-muted-foreground">Added</span><span className="text-foreground">{formatDate(profile.dateAdded)}</span></div>
                  <div className="flex items-center justify-between rounded-lg border border-border bg-secondary/30 px-2.5 py-2"><span className="text-muted-foreground">Updated</span><span className="text-foreground">{formatDate(profile.dateUpdated ?? profile.dateModified)}</span></div>
                  {profile.devNotes && (
                    <div className="rounded-lg border border-border bg-secondary/30 px-2.5 py-2">
                      <p className="mb-1 text-[11px] text-muted-foreground">Dev notes</p>
                      <p className="whitespace-pre-wrap text-xs text-foreground">{profile.devNotes}</p>
                    </div>
                  )}
                </div>
              </div>

              {profile.tags && profile.tags.length > 0 && (
                <div className="rounded-2xl border border-border bg-card p-4">
                  <h2 className="mb-3 text-sm font-semibold text-foreground">Tags</h2>
                  <div className="flex flex-wrap gap-1.5">
                    {profile.tags.map((tag) => (
                      <span key={tag} className="rounded-full border border-border bg-secondary/40 px-2 py-0.5 text-[11px] text-muted-foreground">#{tag}</span>
                    ))}
                  </div>
                </div>
              )}
            </aside>
          </div>
        </div>
      )}

      <Dialog open={installDialogOpen} onOpenChange={setInstallDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("mod.installPackage", "Install package")}</DialogTitle>
            <DialogDescription>
              {installTarget?.sourceLabel
                ? `${t("mod.installSource", "Source")}: ${installTarget.sourceLabel}`
                : t("mod.installChooseMode", "Choose how you want to install this package.")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <button
              type="button"
              onClick={() => {
                setInstallChoice("executable");
                submitInstall("executable");
              }}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-secondary/30 px-3 py-2 text-sm font-medium hover:bg-secondary"
            >
              <FileArchive className="h-4 w-4" />
              {t("mod.installAsExecutable", "Install as executable")}
            </button>

            <button
              type="button"
              onClick={() => setInstallChoice("mod_folder")}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-secondary/30 px-3 py-2 text-sm font-medium hover:bg-secondary"
            >
              <FolderCog className="h-4 w-4" />
              {t("mod.installAsModFolder", "Install as mod folder")}
            </button>

            {installChoice === "mod_folder" && (
              <div className="space-y-2 rounded-lg border border-border bg-card p-3">
                <label className="text-xs text-muted-foreground" htmlFor="install-engine-select">
                  {t("mod.installTargetEngine", "Install target engine")}
                </label>
                <select
                  id="install-engine-select"
                  value={selectedEngineId}
                  onChange={(event) => setSelectedEngineId(event.target.value)}
                  className="w-full rounded-lg border border-border bg-input-background px-2.5 py-2 text-sm text-foreground"
                >
                  {installedEngines.map((engine) => (
                    <option key={engine.id} value={engine.id}>{engine.name} {engine.version}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => submitInstall("mod_folder")}
                  disabled={!hasInstallableEngine}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary/90 px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Download className="h-4 w-4" />
                  {t("mod.install", "Install")}
                </button>
              </div>
            )}
          </div>

          {installError && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
              {installError}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

