import { describe, expect, it } from 'vitest';
import { nameplateIcons, nameplateLayout, QUIET } from '@/features/playground/engine/nameplate';

describe('nameplateLayout', () => {
  it('is the name between its paddings with no icons', () => {
    const layout = nameplateLayout(100, 0);
    expect(layout).toMatchObject({ width: 136, textWidth: 100, textCenter: 68, iconX: [] });
  });

  it('grows by one icon and its gap per icon, up to three', () => {
    const widths = [0, 1, 2, 3].map((icons) => nameplateLayout(100, icons).width);
    expect(widths).toEqual([136, 196, 250, 304]);
    expect(nameplateLayout(100, 3).iconX).toEqual([130, 184, 238]);
  });

  it('keeps icons on whole pixels so their grid stays square', () => {
    const layout = nameplateLayout(99.4, 2);
    expect(layout.textWidth).toBe(100);
    for (const x of [...layout.iconX, layout.iconY, layout.width]) expect(Number.isInteger(x)).toBe(true);
  });

  it('caps a very long name', () => {
    expect(nameplateLayout(5000, 1).textWidth).toBe(640);
  });

  it('has no gap before the icons when there is no name', () => {
    expect(nameplateLayout(0, 1)).toMatchObject({ width: 84, iconX: [18] });
  });
});

describe('nameplateIcons', () => {
  it('shows nothing for someone with mic and ears on', () => {
    expect(nameplateIcons(QUIET)).toEqual([]);
  });

  it('crosses out the mic when muted', () => {
    expect(nameplateIcons({ ...QUIET, micMuted: true })).toEqual([{ name: 'mic', off: true }]);
  });

  it('shows only the crossed speaker when deafened, as a call tile does', () => {
    expect(nameplateIcons({ ...QUIET, micMuted: true, deafened: true })).toEqual([{ name: 'speaker', off: true }]);
  });

  it('adds the screen after the mic for whoever is on the big screen', () => {
    expect(nameplateIcons({ ...QUIET, micMuted: true, presenting: true })).toEqual([{ name: 'mic', off: true }, { name: 'screen', off: false }]);
  });
});
