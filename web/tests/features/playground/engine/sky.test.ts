import { describe, expect, it } from 'vitest';
import { skyColors, starBrightness, sunDirection, sunriseGlow } from '@/features/playground/engine/sky';

describe('sky', () => {
  it('shows the stars only as it gets dark, brightest at midnight', () => {
    expect(starBrightness(6000)).toBe(0);
    expect(starBrightness(18_000)).toBeCloseTo(0.5);
    const dusk = starBrightness(13_000);
    expect(dusk).toBeGreaterThan(0);
    expect(dusk).toBeLessThan(0.5);
  });

  it('glows orange at sunrise and sunset, not by day or night', () => {
    expect(sunriseGlow(6000)).toBeNull();
    expect(sunriseGlow(18_000)).toBeNull();
    const sunset = sunriseGlow(12_200);
    expect(sunset?.strength).toBeGreaterThan(0.5);
    expect(sunset?.color[0]).toBeGreaterThan(sunset!.color[2]);
  });

  it('crosses the sky from east to west, overhead at noon', () => {
    expect(sunDirection(0).x).toBeGreaterThan(0.9);
    expect(sunDirection(6000).y).toBeGreaterThan(0.9);
    expect(sunDirection(12_000).x).toBeLessThan(-0.9);
    expect(sunDirection(18_000).y).toBeLessThan(-0.9);
  });

  it('turns the sky dark at night', () => {
    const noon = skyColors(6000);
    const midnight = skyColors(18_000);
    expect(noon.sky.b).toBeCloseTo(1);
    expect(midnight.sky.getHex()).toBe(0);
    expect(midnight.fog.b).toBeLessThan(noon.fog.b / 4);
  });
});
