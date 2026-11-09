import { describe, expect, it } from 'vitest';
import { soundFileUrl } from '@/features/soundboard/soundboardApi';

describe('soundFileUrl', () => {
  it('is the member route, with the play\'s token when there is one', () => {
    expect(soundFileUrl('srv', 'snd')).toBe('/api/servers/srv/sounds/snd/file');
    expect(soundFileUrl('srv', 'snd', '123.a+b')).toBe('/api/servers/srv/sounds/snd/file?token=123.a%2Bb');
  });
});
