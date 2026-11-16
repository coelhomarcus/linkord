// The programs the app may report as an activity. Nothing outside this list (and the Steam game
// Steam itself says is running) is ever reported: the person never shares more than a known game
// or app, never a process name. Keys are what the server stores and what "hide" refers to, so a
// key never changes once shipped.
//
// `exe`: executable names, compared without case (Windows `.exe`, the Linux binary, or the program
// a Wine/Proton command line runs). `app`: macOS bundle names (`Spotify.app` → 'spotify').
// `java`: a Java program, told apart by a pattern in its command line.

export interface CatalogEntry {
  key: string;
  name: string;
  kind: 'playing' | 'using';
  exe?: string[];
  app?: string[];
  java?: RegExp;
}

export const ACTIVITY_CATALOG: readonly CatalogEntry[] = [
  { key: 'minecraft', name: 'Minecraft', kind: 'playing', exe: ['minecraft.windows.exe'], java: /net\.minecraft|[\\/]\.minecraft[\\/]|minecraft\.launcher/i },
  { key: 'league-of-legends', name: 'League of Legends', kind: 'playing', exe: ['league of legends.exe'], app: ['league of legends'] },
  { key: 'valorant', name: 'VALORANT', kind: 'playing', exe: ['valorant-win64-shipping.exe'] },
  { key: 'fortnite', name: 'Fortnite', kind: 'playing', exe: ['fortniteclient-win64-shipping.exe'] },
  { key: 'roblox', name: 'Roblox', kind: 'playing', exe: ['robloxplayerbeta.exe'], app: ['roblox'] },
  { key: 'genshin-impact', name: 'Genshin Impact', kind: 'playing', exe: ['genshinimpact.exe', 'yuanshen.exe'] },
  { key: 'honkai-star-rail', name: 'Honkai: Star Rail', kind: 'playing', exe: ['starrail.exe'] },
  { key: 'overwatch-2', name: 'Overwatch 2', kind: 'playing', exe: ['overwatch.exe'] },
  { key: 'apex-legends', name: 'Apex Legends', kind: 'playing', exe: ['r5apex.exe', 'r5apex_dx12.exe'] },
  { key: 'counter-strike-2', name: 'Counter-Strike 2', kind: 'playing', exe: ['cs2.exe', 'cs2'] },
  { key: 'dota-2', name: 'Dota 2', kind: 'playing', exe: ['dota2.exe', 'dota2'] },
  { key: 'grand-theft-auto-v', name: 'Grand Theft Auto V', kind: 'playing', exe: ['gta5.exe', 'gta5_enhanced.exe'] },
  { key: 'rocket-league', name: 'Rocket League', kind: 'playing', exe: ['rocketleague.exe'] },
  { key: 'rainbow-six-siege', name: 'Tom Clancy\'s Rainbow Six Siege', kind: 'playing', exe: ['rainbowsix.exe', 'rainbowsix_vulkan.exe'] },
  { key: 'call-of-duty', name: 'Call of Duty', kind: 'playing', exe: ['cod.exe'] },
  { key: 'world-of-warcraft', name: 'World of Warcraft', kind: 'playing', exe: ['wow.exe'], app: ['world of warcraft'] },
  { key: 'hearthstone', name: 'Hearthstone', kind: 'playing', exe: ['hearthstone.exe'], app: ['hearthstone'] },
  { key: 'diablo-iv', name: 'Diablo IV', kind: 'playing', exe: ['diablo iv.exe'] },
  { key: 'elden-ring', name: 'Elden Ring', kind: 'playing', exe: ['eldenring.exe'] },
  { key: 'terraria', name: 'Terraria', kind: 'playing', exe: ['terraria.exe'], app: ['terraria'] },
  { key: 'stardew-valley', name: 'Stardew Valley', kind: 'playing', exe: ['stardew valley.exe', 'stardewvalley.exe'], app: ['stardew valley'] },
  { key: 'among-us', name: 'Among Us', kind: 'playing', exe: ['among us.exe'] },
  { key: 'fall-guys', name: 'Fall Guys', kind: 'playing', exe: ['fallguys_client_game.exe'] },
  { key: 'osu', name: 'osu!', kind: 'playing', exe: ['osu!.exe'], app: ['osu!'] },
  { key: 'the-sims-4', name: 'The Sims 4', kind: 'playing', exe: ['ts4_x64.exe'], app: ['the sims 4'] },
  { key: 'path-of-exile-2', name: 'Path of Exile 2', kind: 'playing', exe: ['pathofexile.exe', 'pathofexile_x64.exe', 'pathofexilesteam.exe'] },

  { key: 'spotify', name: 'Spotify', kind: 'using', exe: ['spotify.exe', 'spotify'], app: ['spotify'] },
  { key: 'visual-studio-code', name: 'Visual Studio Code', kind: 'using', exe: ['code.exe', 'code'], app: ['visual studio code'] },
  { key: 'cursor', name: 'Cursor', kind: 'using', exe: ['cursor.exe', 'cursor'], app: ['cursor'] },
  { key: 'figma', name: 'Figma', kind: 'using', exe: ['figma.exe'], app: ['figma'] },
  { key: 'photoshop', name: 'Adobe Photoshop', kind: 'using', exe: ['photoshop.exe'], app: ['adobe photoshop 2024', 'adobe photoshop 2025', 'adobe photoshop 2026', 'adobe photoshop'] },
  { key: 'premiere-pro', name: 'Adobe Premiere Pro', kind: 'using', exe: ['adobe premiere pro.exe'], app: ['adobe premiere pro 2025', 'adobe premiere pro 2026', 'adobe premiere pro'] },
  { key: 'after-effects', name: 'Adobe After Effects', kind: 'using', exe: ['afterfx.exe'], app: ['adobe after effects 2025', 'adobe after effects 2026', 'adobe after effects'] },
  { key: 'davinci-resolve', name: 'DaVinci Resolve', kind: 'using', exe: ['resolve.exe'], app: ['davinci resolve'] },
  { key: 'blender', name: 'Blender', kind: 'using', exe: ['blender.exe', 'blender'], app: ['blender'] },
  { key: 'obs-studio', name: 'OBS Studio', kind: 'using', exe: ['obs64.exe', 'obs'], app: ['obs'] },
  { key: 'unity', name: 'Unity', kind: 'using', exe: ['unity.exe', 'unity'], app: ['unity'] },
  { key: 'unreal-engine', name: 'Unreal Engine', kind: 'using', exe: ['unrealeditor.exe', 'unrealeditor'], app: ['unrealeditor'] },
  { key: 'android-studio', name: 'Android Studio', kind: 'using', exe: ['studio64.exe'], app: ['android studio'] },
  { key: 'intellij-idea', name: 'IntelliJ IDEA', kind: 'using', exe: ['idea64.exe'], app: ['intellij idea', 'intellij idea ce'] },
  { key: 'xcode', name: 'Xcode', kind: 'using', app: ['xcode'] },
  { key: 'aseprite', name: 'Aseprite', kind: 'using', exe: ['aseprite.exe', 'aseprite'], app: ['aseprite'] },
];
