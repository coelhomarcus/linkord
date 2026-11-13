import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mediaKeyAction } from '@/features/media/mediaKeyboard';

let player: HTMLDivElement;

beforeEach(() => {
  player = document.createElement('div');
  player.tabIndex = 0;
  player.innerHTML = `
    <button type="button" data-testid="button">Play</button>
    <input type="range" data-testid="range" />
    <div role="slider" tabindex="0" data-testid="slider"></div>
    <input type="text" data-testid="field" />
    <div data-testid="surface"></div>`;
  document.body.append(player);
});

afterEach(() => player.remove());

function press(key: string, target: Element = player, init: Partial<KeyboardEventInit> = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, ...init });
  Object.defineProperty(event, 'target', { value: target });
  return mediaKeyAction(event, player);
}

const part = (id: string) => player.querySelector(`[data-testid="${id}"]`)!;

describe('mediaKeyAction', () => {
  it('maps the video-site keys', () => {
    expect(press(' ')).toEqual({ type: 'togglePlay' });
    expect(press('k')).toEqual({ type: 'togglePlay' });
    expect(press('K')).toEqual({ type: 'togglePlay' });
    expect(press('j')).toEqual({ type: 'seekBy', seconds: -10 });
    expect(press('l')).toEqual({ type: 'seekBy', seconds: 10 });
    expect(press('ArrowLeft')).toEqual({ type: 'seekBy', seconds: -5 });
    expect(press('ArrowRight')).toEqual({ type: 'seekBy', seconds: 5 });
    expect(press('ArrowUp')).toEqual({ type: 'volumeBy', step: 0.1 });
    expect(press('ArrowDown')).toEqual({ type: 'volumeBy', step: -0.1 });
    expect(press('m')).toEqual({ type: 'toggleMute' });
    expect(press('f')).toEqual({ type: 'toggleExpanded' });
    expect(press('Home')).toEqual({ type: 'seekToFraction', fraction: 0 });
    expect(press('End')).toEqual({ type: 'seekToFraction', fraction: 1 });
  });

  it('jumps to a tenth of the video per digit', () => {
    expect(press('0')).toEqual({ type: 'seekToFraction', fraction: 0 });
    expect(press('3')).toEqual({ type: 'seekToFraction', fraction: 0.3 });
    expect(press('9')).toEqual({ type: 'seekToFraction', fraction: 0.9 });
  });

  it('leaves other keys and shortcuts with a modifier alone', () => {
    expect(press('x')).toBeNull();
    expect(press('Tab')).toBeNull();
    expect(press('Escape')).toBeNull();
    expect(press('k', player, { ctrlKey: true })).toBeNull();
    expect(press('f', player, { metaKey: true })).toBeNull();
    expect(press('ArrowLeft', player, { altKey: true })).toBeNull();
  });

  it('a held toggle does not flip back and forth, while a held seek keeps seeking', () => {
    expect(press(' ', player, { repeat: true })).toEqual({ type: 'none' });
    expect(press('m', player, { repeat: true })).toEqual({ type: 'none' });
    expect(press('f', player, { repeat: true })).toEqual({ type: 'none' });
    expect(press('l', player, { repeat: true })).toEqual({ type: 'seekBy', seconds: 10 });
    expect(press('ArrowUp', player, { repeat: true })).toEqual({ type: 'volumeBy', step: 0.1 });
  });

  it('a focused slider keeps its arrows, Home and End, but not the other keys', () => {
    for (const id of ['range', 'slider']) {
      for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']) {
        expect(press(key, part(id)), `${id} ${key}`).toBeNull();
      }
      expect(press('k', part(id))).toEqual({ type: 'togglePlay' });
      expect(press('m', part(id))).toEqual({ type: 'toggleMute' });
    }
  });

  it('a focused button keeps Space and Enter', () => {
    expect(press(' ', part('button'))).toBeNull();
    expect(press('Enter', part('button'))).toBeNull();
    expect(press('k', part('button'))).toEqual({ type: 'togglePlay' });
    expect(press('ArrowRight', part('button'))).toEqual({ type: 'seekBy', seconds: 5 });
  });

  it('a text field keeps every key', () => {
    expect(press('k', part('field'))).toBeNull();
    expect(press(' ', part('field'))).toBeNull();
  });

  it('a key from outside the player (a menu it opened, in a portal) is not the player\'s', () => {
    const menu = document.createElement('div');
    document.body.append(menu);
    expect(press('k', menu)).toBeNull();
    menu.remove();
  });

  it('a plain part of the player answers like the player', () => {
    expect(press(' ', part('surface'))).toEqual({ type: 'togglePlay' });
  });
});
