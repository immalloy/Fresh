import type { EngineRelease } from "./types";

export type ClientPlatform = EngineRelease["platform"] | "unknown";

// Platform-specific default paths for the app (Fresh folder locations)
// These are used as defaults in the onboarding setup
export function getPlatformDefaults(platform: ClientPlatform): {
  dataRoot: string;
  downloads: string;
  game: string;
} {
  // All in one Documents/Fresh folder - cleaner organization
  const base = platform === "windows"
    ? "C:\\Users\\%username%\\Documents\\Fresh"
    : platform === "macos"
      ? "~/Documents/Fresh"
      : platform === "linux"
        ? "~/Documents/Fresh"
        : "~/Documents/Fresh";

  // Downloads and game folder under the same Fresh folder
  const downloads = platform === "windows"
    ? "C:\\Users\\%username%\\Documents\\Fresh\\downloads"
    : platform === "macos"
      ? "~/Documents/Fresh/downloads"
      : platform === "linux"
        ? "~/Documents/Fresh/downloads"
        : "~/Documents/Fresh/downloads";

  const game = platform === "windows"
    ? "C:\\Users\\%username%\\Documents\\Fresh\\game"
    : platform === "macos"
      ? "~/Documents/Fresh/game"
      : platform === "linux"
        ? "~/Documents/Fresh/game"
        : "~/Documents/Fresh/game";

  return {
    dataRoot: base,
    downloads,
    game,
  };
}

export function detectClientPlatform(): ClientPlatform {
  if (typeof navigator === "undefined") {
    return "unknown";
  }

  const platform = `${navigator.userAgent} ${navigator.platform}`.toLowerCase();

  if (platform.includes("win")) {
    return "windows";
  }

  if (platform.includes("linux") || platform.includes("x11")) {
    return "linux";
  }

  if (platform.includes("mac") || platform.includes("darwin")) {
    return "macos";
  }

  return "unknown";
}

export function pickBestReleaseForPlatform(
  releases: EngineRelease[],
  platform: ClientPlatform,
): EngineRelease | undefined {
  if (releases.length === 0) {
    return undefined;
  }

  if (platform !== "unknown") {
    const exact = releases.find((release) => release.platform === platform);
    if (exact) {
      return exact;
    }
  }

  const any = releases.find((release) => release.platform === "any");
  if (any) {
    return any;
  }

  return releases[0];
}

