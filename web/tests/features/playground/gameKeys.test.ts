import { describe, expect, it } from 'vitest';
import { gameKeyAction } from '@/features/playground/gameKeys';
import type { GameKey, GameKeyState } from '@/features/playground/gameKeys';

const playing: GameKeyState = { menuOpen: false, chatOpen: false, typing: false, onControl: false };
const key = (code: string, extra: Partial<GameKey> = {}): GameKey => ({ code, key: '', repeat: false, ctrlKey: false, metaKey: false, altKey: false, ...extra });

describe('gameKeyAction', () => {
  it('opens the menu with Esc or Tab, and closes it with Tab, but only once for a held key', () => {
    expect(gameKeyAction(key('Escape'), playing)).toBe('menu');
    expect(gameKeyAction(key('Tab'), playing)).toBe('menu');
    expect(gameKeyAction(key('Tab'), { ...playing, menuOpen: true })).toBe('menu');
    expect(gameKeyAction(key('Tab', { repeat: true }), playing)).toBe('swallow');
  });

  it('leaves Esc to the menu and the chat line when they are open', () => {
    expect(gameKeyAction(key('Escape'), { ...playing, menuOpen: true })).toBeNull();
    expect(gameKeyAction(key('Escape'), { ...playing, chatOpen: true, typing: true })).toBeNull();
  });

  it('opens the chat with T, Enter or /, but lets Enter press a focused button', () => {
    expect(gameKeyAction(key('KeyT'), playing)).toBe('chat');
    expect(gameKeyAction(key('Enter'), playing)).toBe('chat');
    expect(gameKeyAction(key('Slash'), playing)).toBe('chat');
    expect(gameKeyAction(key('Enter'), { ...playing, onControl: true })).toBeNull();
  });

  it('gives the block game\'s function keys, and swallows the browser\'s', () => {
    expect(gameKeyAction(key('F1'), playing)).toBe('hud');
    expect(gameKeyAction(key('F5'), playing)).toBe('camera');
    expect(gameKeyAction(key('F11'), playing)).toBe('fullscreen');
    expect(gameKeyAction(key('F3'), playing)).toBe('swallow');
    expect(gameKeyAction(key('F12'), playing)).toBeNull();
  });

  it('keeps Ctrl with a walking key for the sprint, and swallows every other shortcut', () => {
    expect(gameKeyAction(key('KeyW', { ctrlKey: true }), playing)).toBeNull();
    expect(gameKeyAction(key('KeyR', { ctrlKey: true }), playing)).toBe('swallow');
    expect(gameKeyAction(key('Equal', { ctrlKey: true }), playing)).toBe('swallow');
    expect(gameKeyAction(key('KeyS', { metaKey: true }), playing)).toBe('swallow');
  });

  it('lets a field have its keys, copy and paste included', () => {
    const typing = { ...playing, chatOpen: true, typing: true };
    expect(gameKeyAction(key('KeyT'), typing)).toBeNull();
    expect(gameKeyAction(key('KeyV', { ctrlKey: true }), typing)).toBeNull();
    expect(gameKeyAction(key('Tab'), typing)).toBe('swallow');
  });

  it('lets go of the mouse with Alt (never the menu bar), and swallows Backspace and quick find while playing', () => {
    expect(gameKeyAction(key('AltLeft'), playing)).toBe('release');
    expect(gameKeyAction(key('AltRight', { repeat: true }), playing)).toBe('swallow');
    expect(gameKeyAction(key('Backspace'), playing)).toBe('swallow');
    expect(gameKeyAction(key('Quote'), playing)).toBe('swallow');
    expect(gameKeyAction(key('KeyW'), playing)).toBeNull();
  });

  it('opens the inventory with E and picks a hotbar slot with 1 to 9', () => {
    expect(gameKeyAction(key('KeyE'), playing)).toBe('inventory');
    expect(gameKeyAction(key('KeyE', { repeat: true }), playing)).toBe('swallow');
    expect(gameKeyAction(key('Digit1'), playing)).toBe('hotbar');
    expect(gameKeyAction(key('Digit9'), playing)).toBe('hotbar');
    expect(gameKeyAction(key('Digit0'), playing)).toBeNull();
    expect(gameKeyAction(key('KeyE'), { ...playing, typing: true, chatOpen: true })).toBeNull();
  });

  it('leaves the open inventory its own keys, and keeps Tab from opening the menu over it', () => {
    const inventory = { ...playing, inventoryOpen: true };
    expect(gameKeyAction(key('KeyE'), inventory)).toBeNull();
    expect(gameKeyAction(key('Escape'), inventory)).toBeNull();
    expect(gameKeyAction(key('Digit3'), inventory)).toBeNull();
    expect(gameKeyAction(key('Tab'), inventory)).toBe('swallow');
  });
});

