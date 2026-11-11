import {
  LibraryBig,
  House,
  Layers,
  LayoutGrid,
  Star,
  Clock3,
  Download,
  Settings,
  Link2,
  Search,
  Plus,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Play,
  Ellipsis,
  List,
  SlidersHorizontal,
  Check,
  X,
  FolderOpen,
  ExternalLink,
  Info,
  Gamepad2,
  Globe2,
  LogOut,
  Pencil,
  EyeOff,
  ImagePlus,
  RotateCcw,
  ShieldCheck,
  type LucideIcon,
} from "lucide-preact";
import type { Platform } from "./types";

const icons: Record<string, LucideIcon> = {
  library: LibraryBig,
  home: House,
  layers: Layers,
  grid: LayoutGrid,
  star: Star,
  clock: Clock3,
  download: Download,
  settings: Settings,
  link: Link2,
  search: Search,
  plus: Plus,
  sync: RefreshCw,
  chevron: ChevronDown,
  right: ChevronRight,
  left: ChevronLeft,
  play: Play,
  more: Ellipsis,
  list: List,
  filter: SlidersHorizontal,
  check: Check,
  close: X,
  folder: FolderOpen,
  external: ExternalLink,
  info: Info,
  gamepad: Gamepad2,
  globe: Globe2,
  logout: LogOut,
  edit: Pencil,
  hide: EyeOff,
  image: ImagePlus,
  undo: RotateCcw,
  shield: ShieldCheck,
};
export function Icon({
  name,
  size = 20,
  className = "",
  fill = false,
}: {
  name: string;
  size?: number;
  className?: string;
  fill?: boolean;
}) {
  const Component = icons[name] || Gamepad2;
  return (
    <Component
      size={size}
      strokeWidth={1.7}
      fill={fill ? "currentColor" : "none"}
      class={className}
      aria-hidden="true"
    />
  );
}

const assets: Partial<Record<Platform, string>> = {
  Steam: "steam.svg",
  "Epic Games": "epicgames.svg",
  Xbox: "xbox.png",
  GOG: "gogdotcom.svg",
  EA: "ea.svg",
  Ubisoft: "ubisoft.svg",
  "Battle.net": "battledotnet.svg",
};
/** Local, authentic platform artwork; no remote requests or letter-based substitutes. */
export function Brand({
  platform,
  size = 17,
}: {
  platform: Platform;
  size?: number;
}) {
  const asset = assets[platform];
  return (
    <span
      class="brand-icon"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {asset ? (
        <img
          src={`/brands/${asset}`}
          alt=""
          width={size}
          height={size}
          draggable={false}
        />
      ) : (
        <Icon
          name={platform === "Emulator" ? "gamepad" : "folder"}
          size={size}
        />
      )}
    </span>
  );
}
