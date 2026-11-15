import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HIDDEN_FLAG, linuxAutostartEntry, linuxAutostartFile, linuxExecutable, startedHidden } from '../../src/main/loginItem.js';

describe('startedHidden', () => {
  it('is true for a macOS login start or the hidden flag', () => {
    assert.equal(startedHidden({ argv: ['linkord'], wasOpenedAtLogin: true }), true);
    assert.equal(startedHidden({ argv: ['linkord', HIDDEN_FLAG], wasOpenedAtLogin: false }), true);
  });

  it('is false for a start by hand', () => {
    assert.equal(startedHidden({ argv: ['linkord', '--url=https://chat.example'], wasOpenedAtLogin: false }), false);
  });
});

describe('Linux autostart', () => {
  it('honours XDG_CONFIG_HOME, else ~/.config', () => {
    assert.equal(linuxAutostartFile({ XDG_CONFIG_HOME: '/cfg' }, '/home/a'), '/cfg/autostart/linkord.desktop');
    assert.equal(linuxAutostartFile({}, '/home/a'), '/home/a/.config/autostart/linkord.desktop');
  });

  it('runs the AppImage when there is one, else the installed binary', () => {
    assert.equal(linuxExecutable({ APPIMAGE: '/home/a/Linkord.AppImage' }, '/tmp/.mount_x/linkord'), '/home/a/Linkord.AppImage');
    assert.equal(linuxExecutable({}, '/opt/Linkord/linkord'), '/opt/Linkord/linkord');
  });

  it('starts hidden and quotes a path the spec would split', () => {
    assert.match(linuxAutostartEntry('/opt/Linkord/linkord'), /^Exec=\/opt\/Linkord\/linkord --hidden$/m);
    assert.match(linuxAutostartEntry('/home/a/My Apps/Linkord "x".AppImage'), /^Exec="\/home\/a\/My Apps\/Linkord \\"x\\"\.AppImage" --hidden$/m);
  });
});
