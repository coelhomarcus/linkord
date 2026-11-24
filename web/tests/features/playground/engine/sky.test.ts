import { describe, expect, it } from 'vitest';
import { LAYERS, layerFade, skyColors, sunDirection } from '@/features/playground/engine/sky';

const [day, night, stars] = LAYERS;

describe('sky', () => {
  it('shows the day box by day and the night boxes at night, as the pack times them', () => {
    expect(layerFade(day!, 6000)).toBe(1);
    expect(layerFade(night!, 6000)).toBe(0);
    expect(layerFade(stars!, 6000)).toBe(0);
    expect(layerFade(day!, 18_000)).toBe(0);
    expect(layerFade(night!, 18_000)).toBe(1);
    expect(layerFade(stars!, 18_000)).toBe(1);
  });

  it('fades a box in and out over half an hour on each side of its hours', () => {
    // the day box: in from 5:00 to 5:30 (23000..23500), out from 17:30 to 18:00 (11500..12000)
    expect(layerFade(day!, 23_250)).toBeCloseTo(0.5);
    expect(layerFade(day!, 11_750)).toBeCloseTo(0.5);
    expect(layerFade(day!, 22_900)).toBe(0);
    // the stars wrap past midnight: out from 5:00 (23000), gone at 5:30
    expect(layerFade(stars!, 23_250)).toBeCloseTo(0.5);
    expect(layerFade(stars!, 23_600)).toBe(0);
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
