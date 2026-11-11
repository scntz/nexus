export const platforms = [
  "Steam",
  "Epic Games",
  "Xbox",
  "GOG",
  "EA",
  "Ubisoft",
  "Battle.net",
  "Standalone",
  "Emulator",
] as const;
export type Platform = (typeof platforms)[number];
export interface Game {
  id: string;
  name: string;
  platform: Platform;
  installed: boolean;
  cover?: string;
  hero?: string;
  favorite: boolean;
  lastPlayed?: number;
  playtime?: number;
  genre?: string;
  description?: string;
  executable?: string;
  arguments?: string[];
  launchUri?: string;
  installUri?: string;
  installPath?: string;
  appId?: string;
  catalogNamespace?: string;
  catalogItemId?: string;
  customized?: boolean;
  system?: string;
  downloadBytes?: number;
  downloadTotal?: number;
  discoverySource?: "local" | "history" | "manual" | "saved";
}
export interface SourceStatus {
  platform: Platform;
  count: number;
  detected: boolean;
  detail: string;
}
export interface Discovery {
  games: Game[];
  sources: SourceStatus[];
  warnings: string[];
  failedPlatforms: Platform[];
  scannedAt: number;
  scannedPlatforms?: Platform[];
}
export interface Preferences {
  compact: boolean;
  reduceMotion: boolean;
  groupCopies?: boolean;
  playerName: string;
}
export interface FolderSource {
  id: string;
  path: string;
  system?: string;
  executable?: string;
}
