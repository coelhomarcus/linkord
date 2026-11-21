import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ACTIVITY_CATALOG } from '../../src/main/activityCatalog.js';
import {
  detectCandidates, foregroundKey, macAppName, needsArgs, parseForegroundLine, parseLibraryFolders, parseLsappinfoPid, parsePsOutput,
  parseRegDword, parseRegString, parseTasklistCsv, parseVdfValue, parseXpropPid, parseXpropWindow, processName, runningAppId,
  type SteamGame,
} from '../../src/main/activityDetect.js';

const listed = (processes: { path: string; args?: string }[]) => processes.map((p, i) => ({ pid: i + 1, ...p }));
const candidates = (processes: { path: string; args?: string }[], platform: NodeJS.Platform, steam: SteamGame | null = null) =>
  detectCandidates({ processes: listed(processes), steam, catalog: ACTIVITY_CATALOG, platform });
const detect = (processes: { path: string; args?: string }[], platform: NodeJS.Platform, steam: SteamGame | null = null) =>
  candidates(processes, platform, steam)[0] ?? null;

describe('detectCandidates', () => {
  it('lists the Steam game Steam says is running first', () => {
    const found = candidates([{ path: 'C:\\Program Files\\Spotify\\Spotify.exe' }], 'win32', { appId: 570, name: 'Dota 2' });
    assert.deepEqual(found[0], { key: 'steam:570', kind: 'playing', name: 'Dota 2', steamAppId: 570, pids: [] });
    assert.equal(found[1]?.key, 'spotify');
  });

  it('lists every running catalog entry, each with all its processes', () => {
    const found = candidates([{ path: 'Spotify.exe' }, { path: 'RobloxPlayerBeta.exe' }, { path: 'Spotify.exe' }], 'win32');
    assert.deepEqual(found, [
      { key: 'roblox', kind: 'playing', name: 'Roblox', pid: 2, pids: [2] },
      { key: 'spotify', kind: 'using', name: 'Spotify', pid: 1, pids: [1, 3] },
    ]);
  });

  it('keeps the full path of what it found, for the icon', () => {
    const found = detect([{ path: 'C:\\Users\\a\\AppData\\Roaming\\Spotify\\Spotify.exe' }], 'win32');
    assert.equal(found?.exePath, 'C:\\Users\\a\\AppData\\Roaming\\Spotify\\Spotify.exe');
    assert.equal(found?.kind, 'using');
  });

  it('finds a macOS app by its bundle, helpers included', () => {
    const found = detect([{ path: '/Applications/Spotify.app/Contents/Frameworks/Spotify Helper.app/Contents/MacOS/Spotify Helper' }], 'darwin');
    assert.equal(found?.key, 'spotify');
    assert.equal(detect([{ path: '/Applications/Visual Studio Code.app/Contents/MacOS/Electron' }], 'darwin')?.key, 'visual-studio-code');
  });

  it('tells Minecraft Java from other Java programs by its command line', () => {
    assert.equal(detect([{ path: 'javaw.exe', args: 'javaw.exe -cp ... net.minecraft.client.main.Main' }], 'win32')?.key, 'minecraft');
    assert.equal(detect([{ path: '/usr/bin/java', args: 'java -jar build-tool.jar' }], 'linux'), null);
  });

  it('finds a Windows game run through Wine or Proton on Linux', () => {
    assert.equal(detect([{ path: '/usr/bin/wine64-preloader', args: 'Z:\\games\\Terraria\\Terraria.exe' }], 'linux')?.key, 'terraria');
  });

  it('reports nothing for programs outside the list', () => {
    assert.equal(detect([{ path: 'C:\\Windows\\explorer.exe' }, { path: 'C:\\bank\\homebanking.exe' }], 'win32'), null);
  });
});

describe('foregroundKey', () => {
  const steam: SteamGame = { appId: 1145360, name: 'Hades', installDir: 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Hades' };

  it('names the catalog entry that owns the window in front', () => {
    const processes = listed([{ path: 'Spotify.exe' }, { path: 'RobloxPlayerBeta.exe' }]);
    const found = detectCandidates({ processes, steam: null, catalog: ACTIVITY_CATALOG, platform: 'win32' });
    assert.equal(foregroundKey(found, { pid: 1, path: null }, processes, null), 'spotify');
    assert.equal(foregroundKey(found, { pid: 99, path: null }, processes, null), null);
    assert.equal(foregroundKey(found, null, processes, null), null);
  });

  it('knows a Steam game in front by its folder, whatever the case or slashes', () => {
    const processes = listed([{ path: 'Hades.exe' }, { path: 'Spotify.exe' }]);
    const found = detectCandidates({ processes, steam, catalog: ACTIVITY_CATALOG, platform: 'win32' });
    assert.equal(foregroundKey(found, { pid: 1, path: 'c:/program files (x86)/steam/steamapps/common/hades/x64/Hades.exe' }, processes, steam), 'steam:1145360');
    assert.equal(foregroundKey(found, { pid: 2, path: 'C:\\Spotify\\Spotify.exe' }, processes, steam), 'spotify');
  });

  it('knows a Proton game in front by its command line', () => {
    const linuxSteam: SteamGame = { appId: 1145360, name: 'Hades', installDir: '/home/a/.local/share/Steam/steamapps/common/Hades' };
    const processes = listed([{ path: '/usr/bin/wine64-preloader', args: 'Z:\\home\\a\\.local\\share\\Steam\\steamapps\\common\\Hades\\x64\\Hades.exe' }]);
    const found = detectCandidates({ processes, steam: linuxSteam, catalog: ACTIVITY_CATALOG, platform: 'linux' });
    assert.equal(foregroundKey(found, { pid: 1, path: '/usr/bin/wine64-preloader' }, processes, linuxSteam), 'steam:1145360');
  });

  it('does not take a folder that only starts the same for the game\'s', () => {
    const processes = listed([{ path: 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Hades II\\Hades2.exe' }]);
    const found = detectCandidates({ processes, steam, catalog: ACTIVITY_CATALOG, platform: 'win32' });
    assert.equal(foregroundKey(found, { pid: 1, path: processes[0]!.path }, processes, steam), null);
  });
});

describe('process helpers', () => {
  it('names a process and its macOS bundle', () => {
    assert.equal(processName('C:\\Games\\VALORANT-Win64-Shipping.exe'), 'valorant-win64-shipping.exe');
    assert.equal(processName('/usr/bin/blender'), 'blender');
    assert.equal(macAppName('/Applications/Figma.app/Contents/MacOS/Figma'), 'figma');
    assert.equal(macAppName('/usr/bin/ssh'), null);
  });

  it('reads command lines only for Java, and for Wine on Linux', () => {
    assert.equal(needsArgs({ pid: 1, path: 'javaw.exe' }, 'win32'), true);
    assert.equal(needsArgs({ pid: 1, path: '/usr/bin/wine64-preloader' }, 'linux'), true);
    assert.equal(needsArgs({ pid: 1, path: 'Code.exe' }, 'win32'), false);
  });
});

describe('system output parsers', () => {
  it('reads the foreground process on each system', () => {
    assert.equal(parseLsappinfoPid('"pid"=86502\n'), 86502);
    assert.equal(parseLsappinfoPid(''), null);
    assert.equal(parseXpropWindow('_NET_ACTIVE_WINDOW(WINDOW): window id # 0x3a00007\n'), '0x3a00007');
    assert.equal(parseXpropWindow('_NET_ACTIVE_WINDOW(WINDOW): window id # 0x0\n'), null);
    assert.equal(parseXpropPid('_NET_WM_PID(CARDINAL) = 4120\n'), 4120);
    assert.deepEqual(parseForegroundLine('4120\tC:\\Games\\Hades.exe\r\n'), { pid: 4120, path: 'C:\\Games\\Hades.exe' });
    assert.deepEqual(parseForegroundLine('4120\t\r\n'), { pid: 4120, path: null });
    assert.equal(parseForegroundLine('0\t'), null);
  });

  it('reads tasklist CSV', () => {
    const text = '"System Idle Process","0","Services","0","8 K"\r\n"Spotify.exe","4120","Console","1","120,000 K"\r\n';
    assert.deepEqual(parseTasklistCsv(text), [{ path: 'System Idle Process', pid: 0 }, { path: 'Spotify.exe', pid: 4120 }]);
  });

  it('reads ps output with spaces in paths', () => {
    const text = '  1 /sbin/launchd\n 812 /Applications/Visual Studio Code.app/Contents/MacOS/Electron\n';
    assert.deepEqual(parsePsOutput(text), [{ pid: 1, path: '/sbin/launchd' }, { pid: 812, path: '/Applications/Visual Studio Code.app/Contents/MacOS/Electron' }]);
  });

  it('reads Steam values from the Windows registry', () => {
    const text = '\r\nHKEY_CURRENT_USER\\Software\\Valve\\Steam\r\n    RunningAppID    REG_DWORD    0x23a\r\n    SteamPath    REG_SZ    c:/program files (x86)/steam\r\n';
    assert.equal(parseRegDword(text, 'RunningAppID'), 570);
    assert.equal(parseRegString(text, 'SteamPath'), 'c:/program files (x86)/steam');
  });

  it('reads Valve KeyValues files', () => {
    const registry = '"Registry"\n{\n\t"HKCU"\n\t{\n\t\t"Software"\n\t\t{\n\t\t\t"Valve"\n\t\t\t{\n\t\t\t\t"Steam"\n\t\t\t\t{\n\t\t\t\t\t"RunningAppID"\t\t"1145350"\n';
    assert.equal(runningAppId(parseVdfValue(registry, 'RunningAppID')), 1145350);
    assert.equal(runningAppId('0'), null);
    assert.equal(parseVdfValue('"AppState"\n{\n\t"appid"\t\t"570"\n\t"name"\t\t"Dota 2"\n}', 'name'), 'Dota 2');
    assert.deepEqual(parseLibraryFolders('"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"C:\\\\Program Files (x86)\\\\Steam"\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"D:\\\\SteamLibrary"\n\t}\n}'),
      ['C:\\Program Files (x86)\\Steam', 'D:\\SteamLibrary']);
  });
});

describe('the catalog', () => {
  it('has unique keys the server accepts', () => {
    const keys = ACTIVITY_CATALOG.map((entry) => entry.key);
    assert.equal(new Set(keys).size, keys.length);
    for (const key of keys) assert.match(key, /^[a-z0-9][a-z0-9:._-]{0,79}$/);
  });

  it('lists executable and bundle names in lowercase, as they are compared', () => {
    for (const entry of ACTIVITY_CATALOG) {
      for (const name of [...(entry.exe ?? []), ...(entry.app ?? [])]) assert.equal(name, name.toLowerCase(), entry.key);
    }
  });
});
