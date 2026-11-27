// Builds packages/frontend-shared/src/ui/icons/fluent.ts from the pinned @fluentui/svg-icons
// devDependency (Fluent UI System Icons, MIT, Microsoft): the path data of every
// icon the apps import from the shared icon module, in the 20 px regular and filled
// styles only. The app keeps its own icon names (the ones it had under Phosphor)
// so a component never names a Fluent file; FLUENT_ICONS says which file each
// one draws. Run it after importing a new icon, changing that table or bumping
// @fluentui/svg-icons:
//
//   bun run icons
//
// tests/scripts/buildIcons.test.tsx fails while the generated file is stale.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageRoot = path.dirname(require.resolve('@fluentui/svg-icons/package.json'));
const packageVersion: string = require('@fluentui/svg-icons/package.json').version;

const adminRoot = path.resolve(webRoot, '../admin');
const sharedRoot = path.resolve(webRoot, '../packages/frontend-shared/src');
export const ICON_MODULE = path.join(sharedRoot, 'ui', 'icons', 'fluent.ts');
const BRAND_MODULE = path.join(sharedRoot, 'ui', 'icons', 'brands.tsx');
/** The app's weights and the Fluent style each one draws. */
export const STYLES = { regular: 'regular', fill: 'filled' } as const;
/** Fluent draws each icon per size; 20 is the one made for the 16 to 24 px the app shows. */
export const ARTWORK_SIZE = 20;

/** App icon name -> Fluent icon file (without `_20_regular.svg`). */
export const FLUENT_ICONS: Record<string, string> = {
  AirplaneIcon: 'airplane',
  AppWindowIcon: 'window',
  ArrowBendUpLeftIcon: 'arrow_reply',
  ArrowClockwiseIcon: 'arrow_clockwise',
  ArrowCounterClockwiseIcon: 'arrow_counterclockwise',
  ArrowDownIcon: 'arrow_down',
  ArrowLeftIcon: 'arrow_left',
  ArrowSquareInIcon: 'window_arrow_up',
  ArrowSquareOutIcon: 'open',
  ArrowUpIcon: 'arrow_up',
  ArrowsClockwiseIcon: 'arrow_sync',
  ArrowsDownUpIcon: 'arrow_sort',
  ArrowsInIcon: 'full_screen_minimize',
  ArrowsInSimpleIcon: 'arrow_minimize',
  ArrowsLeftRightIcon: 'arrow_swap',
  ArrowsOutIcon: 'full_screen_maximize',
  AtIcon: 'mention',
  BasketballIcon: 'sport_basketball',
  BellIcon: 'alert',
  BellRingingIcon: 'alert_on',
  BellSlashIcon: 'alert_off',
  BookOpenIcon: 'book_open',
  BookmarkSimpleIcon: 'bookmark',
  CalendarBlankIcon: 'calendar',
  CameraIcon: 'camera',
  CardsIcon: 'card_ui',
  CaretDownIcon: 'chevron_down',
  CaretLeftIcon: 'chevron_left',
  CaretRightIcon: 'chevron_right',
  CaretUpIcon: 'chevron_up',
  CellSignalLowIcon: 'cellular_data_3',
  CellSignalNoneIcon: 'cellular_off',
  ChartLineIcon: 'data_line',
  ChatCircleIcon: 'chat',
  ChatCircleTextIcon: 'chat_multiple',
  ChatTextIcon: 'comment_text',
  CheckCircleIcon: 'checkmark_circle',
  CheckIcon: 'checkmark',
  ChecksIcon: 'mail_read',
  CircleNotchIcon: 'spinner_ios',
  ClockCounterClockwiseIcon: 'history',
  ClockIcon: 'clock',
  CopyIcon: 'copy',
  CrosshairIcon: 'target',
  CrownIcon: 'crown',
  DesktopIcon: 'desktop',
  DeviceMobileIcon: 'phone',
  DotsSixVerticalIcon: 're_order_dots_vertical',
  DotsThreeIcon: 'more_horizontal',
  DownloadSimpleIcon: 'arrow_download',
  EnvelopeIcon: 'mail',
  EnvelopeSimpleIcon: 'mail',
  ExportIcon: 'share_ios',
  EyeIcon: 'eye',
  EyeSlashIcon: 'eye_off',
  EyedropperIcon: 'eyedropper',
  FileArchiveIcon: 'folder_zip',
  FileAudioIcon: 'music_note_2',
  FileCodeIcon: 'code',
  FileIcon: 'document',
  FileImageIcon: 'document_image',
  FilePdfIcon: 'document_pdf',
  FilePptIcon: 'slide_text',
  FileTextIcon: 'document_text',
  FileVideoIcon: 'video_clip',
  FileXIcon: 'document_dismiss',
  FileXlsIcon: 'document_table',
  FilesIcon: 'document_multiple',
  FilmStripIcon: 'filmstrip',
  FlagIcon: 'flag',
  FlipHorizontalIcon: 'flip_horizontal',
  FolderPlusIcon: 'folder_add',
  GameControllerIcon: 'games',
  GaugeIcon: 'gauge',
  GearIcon: 'settings',
  GearSixIcon: 'settings',
  GifIcon: 'gif',
  GlobeIcon: 'globe',
  HamburgerIcon: 'food',
  HardDrivesIcon: 'server',
  HashIcon: 'number_symbol',
  HeadphonesIcon: 'headphones',
  HeartIcon: 'heart',
  IdentificationBadgeIcon: 'contact_card',
  IdentificationCardIcon: 'contact_card',
  ImageBrokenIcon: 'image_off',
  ImageIcon: 'image',
  ImageSquareIcon: 'image',
  InfoIcon: 'info',
  KeyIcon: 'key',
  LeafIcon: 'leaf_two',
  LightbulbIcon: 'lightbulb',
  LightningIcon: 'flash',
  LinkBreakIcon: 'link_dismiss',
  LinkIcon: 'link',
  LockIcon: 'lock_closed',
  LockKeyOpenIcon: 'lock_open',
  LockSimpleIcon: 'lock_closed',
  MagnifyingGlassIcon: 'search',
  MagnifyingGlassMinusIcon: 'zoom_out',
  MagnifyingGlassPlusIcon: 'zoom_in',
  MicrophoneIcon: 'mic',
  MicrophoneSlashIcon: 'mic_off',
  MinusIcon: 'subtract',
  MonitorIcon: 'share_screen_start',
  MonitorPlayIcon: 'live',
  MusicNoteIcon: 'music_note_1',
  MusicNotesIcon: 'music_note_2',
  PackageIcon: 'box',
  PaintBrushIcon: 'paint_brush',
  PaperclipIcon: 'attach',
  PauseIcon: 'pause',
  PencilSimpleIcon: 'edit',
  PhoneIcon: 'call',
  PhoneSlashIcon: 'call_end',
  PhoneXIcon: 'call_end',
  PictureInPictureIcon: 'picture_in_picture',
  PlayIcon: 'play',
  PlugsConnectedIcon: 'plug_connected',
  PlusCircleIcon: 'add_circle',
  PlusIcon: 'add',
  PlusSquareIcon: 'add_square',
  PowerIcon: 'power',
  ProhibitIcon: 'prohibited',
  PushPinIcon: 'pin',
  PushPinSlashIcon: 'pin_off',
  ScreencastIcon: 'share_screen_start',
  ScrollIcon: 'document_bullet_list_clock',
  ShieldCheckIcon: 'shield_checkmark',
  ShieldIcon: 'shield',
  SidebarSimpleIcon: 'panel_left',
  SignOutIcon: 'sign_out',
  SlidersHorizontalIcon: 'options',
  SmileyIcon: 'emoji',
  SpeakerHighIcon: 'speaker_2',
  SpeakerLowIcon: 'speaker_1',
  SpeakerSimpleSlashIcon: 'speaker_mute',
  SpeakerSlashIcon: 'speaker_off',
  SquaresFourIcon: 'grid',
  StickerIcon: 'sticker',
  StopIcon: 'stop',
  TranslateIcon: 'translate',
  TrashIcon: 'delete',
  TrayIcon: 'mail_inbox',
  UploadSimpleIcon: 'arrow_upload',
  UserCheckIcon: 'person_available',
  UserCircleIcon: 'person_circle',
  UserIcon: 'person',
  UserMinusIcon: 'person_subtract',
  UserPlusIcon: 'person_add',
  UsersIcon: 'people',
  UsersThreeIcon: 'people_team',
  VideoCameraIcon: 'video',
  VideoCameraSlashIcon: 'video_off',
  WarningCircleIcon: 'error_circle',
  WarningIcon: 'warning',
  WebhooksLogoIcon: 'bot',
  XIcon: 'dismiss',
};

const IMPORT = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'(?:(?:@\/shared|@overcord\/frontend-shared)\/ui\/icons|\.{1,2}\/(?:ui\/)?icons)'/g;
const ICON_NAME = /^[A-Z]\w*Icon$/;
const SVG = /^<svg [^>]*viewBox="0 0 (\d+) \1"[^>]*>(.*)<\/svg>\s*$/s;
const PATH = /<path d="([^"]+)"\/>/g;

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(file);
    return /\.tsx?$/.test(entry.name) ? [file] : [];
  });
}

/** Every shared icon imported by either frontend or the shared package, except the brand logos. */
export function importedIconNames(roots = [
  path.join(webRoot, 'src'), path.join(webRoot, 'tests'),
  path.join(adminRoot, 'src'), path.join(adminRoot, 'tests'), sharedRoot,
]): string[] {
  const brands = new Set([...fs.readFileSync(BRAND_MODULE, 'utf8').matchAll(/export const (\w+Icon)\b/g)].map((match) => match[1]));
  const names = new Set<string>();
  for (const file of roots.flatMap(sourceFiles)) {
    for (const match of fs.readFileSync(file, 'utf8').matchAll(IMPORT)) {
      for (const specifier of match[1]!.split(',')) {
        const name = specifier.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]!;
        if (ICON_NAME.test(name) && !brands.has(name)) names.add(name);
      }
    }
  }
  return [...names].sort();
}

/** The `d` of every path in one Fluent SVG, refusing anything createIcon cannot draw. */
export function fluentPaths(icon: string, style: (typeof STYLES)[keyof typeof STYLES]): string[] {
  const fluentName = FLUENT_ICONS[icon];
  if (!fluentName) throw new Error(`${icon} has no Fluent icon: add it to FLUENT_ICONS in web/scripts/buildIcons.ts`);
  const file = path.join(packageRoot, 'icons', `${fluentName}_${ARTWORK_SIZE}_${style}.svg`);
  if (!fs.existsSync(file)) throw new Error(`@fluentui/svg-icons has no ${fluentName} at ${ARTWORK_SIZE} px (${style})`);
  const svg = SVG.exec(fs.readFileSync(file, 'utf8'));
  if (!svg || Number(svg[1]) !== ARTWORK_SIZE) throw new Error(`${fluentName} (${style}) is not a ${ARTWORK_SIZE} px square`);
  const paths = [...svg[2]!.matchAll(PATH)].map((match) => match[1]!);
  if (paths.length === 0 || svg[2]!.replace(PATH, '') !== '') {
    throw new Error(`${fluentName} (${style}) draws something other than plain <path d>; teach createIcon to draw it`);
  }
  return paths;
}

/** The source of fluent.ts for these icons. */
export function renderIconModule(names: string[]): string {
  const lines = [
    `// Generated by web/scripts/buildIcons.ts from @fluentui/svg-icons ${packageVersion}`,
    '// (Fluent UI System Icons, MIT License, Copyright (c) 2020 Microsoft Corporation).',
    '// Do not edit: import the icon from the shared icon module and run `bun run icons`.',
    "import { createIcon } from './createIcon';",
    '',
  ];
  for (const name of names) {
    const paths = Object.values(STYLES).map((style) => JSON.stringify(fluentPaths(name, style)).replaceAll('"', "'"));
    lines.push(`export const ${name} = /* @__PURE__ */ createIcon('${name}', ${paths.join(', ')});`);
  }
  return `${lines.join('\n')}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const names = importedIconNames();
  fs.writeFileSync(ICON_MODULE, renderIconModule(names));
  console.log(`Wrote ${names.length} icons to ${path.relative(process.cwd(), ICON_MODULE)}`);
}
