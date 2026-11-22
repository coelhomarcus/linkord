import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ACTIVITY_CATALOG } from '../../src/main/activityCatalog.js';
import {
  detectCandidates, foregroundKey, needsArgs, parseForegroundLine, parseLibraryFolders,
  parseRegDword, parseRegString, parseTasklistCsv, parseVdfValue, processName, runningAppId,
  type SteamGame,
} from '../../src/main/activityDetect.js';

const listed = (processes: { path: string; args?: string }[]) => processes.map((p, i) => ({ pid: i + 1, ...p }));
const candidates = (processes: { path: string; args?: string }[], steam: SteamGame | null = null) =>
  detectCandidates({ processes: listed(processes), steam, catalog: ACTIVITY_CATALOG });
const detect = (processes: { path: string; args?: string }[], steam: SteamGame | null = null) =>
  candidates(processes, steam)[0] ?? null;

describe('detectCandidates', () => {
  it('lists the Steam game Steam says is running first', () => {
    const found = candidates([{ path: 'C:\\Program Files\\Spotify\\Spotify.exe' }], { appId: 570, name: 'Dota 2' });
    assert.deepEqual(found[0], { key: 'steam:570', kind: 'playing', name: 'Dota 2', steamAppId: 570, pids: [] });
    assert.equal(found[1]?.key, 'spotify');
  });

  it('lists every running catalog entry, each with all its processes', () => {
    const found = candidates([{ path: 'Spotify.exe' }, { path: 'RobloxPlayerBeta.exe' }, { path: 'Spotify.exe' }]);
    assert.deepEqual(found, [
      { key: 'roblox', kind: 'playing', name: 'Roblox', pid: 2, pids: [2] },
      { key: 'spotify', kind: 'using', name: 'Spotify', pid: 1, pids: [1, 3] },
    ]);
  });

  it('keeps the full path of what it found, for the icon', () => {
    const found = detect([{ path: 'C:\\Users\\a\\AppData\\Roaming\\Spotify\\Spotify.exe' }]);
    assert.equal(found?.exePath, 'C:\\Users\\a\\AppData\\Roaming\\Spotify\\Spotify.exe');
    assert.equal(found?.kind, 'using');
  });

  it('tells Minecraft Java from other Java programs by its command line', () => {
    assert.equal(detect([{ path: 'javaw.exe', args: 'javaw.exe -cp ... net.minecraft.client.main.Main' }])?.key, 'minecraft');
    assert.equal(detect([{ path: 'java.exe', args: 'java -jar build-tool.jar' }]), null);
  });

  it('reports nothing for programs outside the list', () => {
    assert.equal(detect([{ path: 'C:\\Windows\\explorer.exe' }, { path: 'C:\\bank\\homebanking.exe' }]), null);
  });
});

describe('foregroundKey', () => {
  const steam: SteamGame = { appId: 1145360, name: 'Hades', installDir: 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Hades' };

  it('names the catalog entry that owns the window in front', () => {
    const processes = listed([{ path: 'Spotify.exe' }, { path: 'RobloxPlayerBeta.exe' }]);
    const found = detectCandidates({ processes, steam: null, catalog: ACTIVITY_CATALOG });
    assert.equal(foregroundKey(found, { pid: 1, path: null }, processes, null), 'spotify');
    assert.equal(foregroundKey(found, { pid: 99, path: null }, processes, null), null);
    assert.equal(foregroundKey(found, null, processes, null), null);
  });

  it('knows a Steam game in front by its folder, whatever the case or slashes', () => {
    const processes = listed([{ path: 'Hades.exe' }, { path: 'Spotify.exe' }]);
    const found = detectCandidates({ processes, steam, catalog: ACTIVITY_CATALOG });
    assert.equal(foregroundKey(found, { pid: 1, path: 'c:/program files (x86)/steam/steamapps/common/hades/x64/Hades.exe' }, processes, steam), 'steam:1145360');
    assert.equal(foregroundKey(found, { pid: 2, path: 'C:\\Spotify\\Spotify.exe' }, processes, steam), 'spotify');
  });

  it('does not take a folder that only starts the same for the game\'s', () => {
    const processes = listed([{ path: 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Hades II\\Hades2.exe' }]);
    const found = detectCandidates({ processes, steam, catalog: ACTIVITY_CATALOG });
    assert.equal(foregroundKey(found, { pid: 1, path: processes[0]!.path }, processes, steam), null);
  });
});

describe('process helpers', () => {
  it('names a process from its path or name', () => {
    assert.equal(processName('C:\\Games\\VALORANT-Win64-Shipping.exe'), 'valorant-win64-shipping.exe');
    assert.equal(processName('Code.exe'), 'code.exe');
  });

  it('reads command lines only for Java', () => {
    assert.equal(needsArgs({ pid: 1, path: 'javaw.exe' }), true);
    assert.equal(needsArgs({ pid: 1, path: 'Code.exe' }), false);
  });
});

describe('system output parsers', () => {
  it('reads the foreground process', () => {
    assert.deepEqual(parseForegroundLine('4120\tC:\\Games\\Hades.exe\r\n'), { pid: 4120, path: 'C:\\Games\\Hades.exe' });
    assert.deepEqual(parseForegroundLine('4120\t\r\n'), { pid: 4120, path: null });
    assert.equal(parseForegroundLine('0\t'), null);
  });

  it('reads tasklist CSV', () => {
    const text = '"System Idle Process","0","Services","0","8 K"\r\n"Spotify.exe","4120","Console","1","120,000 K"\r\n';
    assert.deepEqual(parseTasklistCsv(text), [{ path: 'System Idle Process', pid: 0 }, { path: 'Spotify.exe', pid: 4120 }]);
  });

  it('reads Steam values from the Windows registry', () => {
    const text = '\r\nHKEY_CURRENT_USER\\Software\\Valve\\Steam\r\n    RunningAppID    REG_DWORD    0x23a\r\n    SteamPath    REG_SZ    c:/program files (x86)/steam\r\n';
    assert.equal(parseRegDword(text, 'RunningAppID'), 570);
    assert.equal(parseRegString(text, 'SteamPath'), 'c:/program files (x86)/steam');
    assert.equal(runningAppId(parseRegDword(text, 'RunningAppID')), 570);
    assert.equal(runningAppId(0), null);
    assert.equal(runningAppId(null), null);
  });

  it('reads Valve KeyValues files', () => {
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

  it('lists Windows executable names in lowercase, as they are compared', () => {
    for (const entry of ACTIVITY_CATALOG) {
      for (const name of entry.exe ?? []) {
        assert.equal(name, name.toLowerCase(), entry.key);
        assert.match(name, /\.exe$/, entry.key);
      }
    }
  });
});
