import { describe, expect, it } from 'vitest';
import { ConnectionQuality } from 'livekit-client';
import { connectionStrength } from '@/features/calls/connectionStrength';

describe('connectionStrength', () => {
  it('the ping alone sets the bars: 3 green, 2 yellow, 1 red', () => {
    expect(connectionStrength(40, ConnectionQuality.Excellent, false)).toMatchObject({ bars: 3, tone: 'good', label: 'Conexão boa' });
    expect(connectionStrength(99, ConnectionQuality.Unknown, false)).toMatchObject({ bars: 3, tone: 'good' });
    expect(connectionStrength(100, ConnectionQuality.Excellent, false)).toMatchObject({ bars: 2, tone: 'fair', label: 'Conexão instável' });
    expect(connectionStrength(250, ConnectionQuality.Excellent, false)).toMatchObject({ bars: 1, tone: 'poor', label: 'Conexão ruim' });
  });

  it("LiveKit's quality only takes bars away, and says why", () => {
    expect(connectionStrength(40, ConnectionQuality.Poor, false)).toMatchObject({ bars: 1, tone: 'poor', note: 'A rede está perdendo pacotes de áudio ou vídeo.' });
    expect(connectionStrength(40, ConnectionQuality.Good, false)).toMatchObject({ bars: 2, tone: 'fair' });
    expect(connectionStrength(300, ConnectionQuality.Excellent, false)).toMatchObject({ bars: 1, note: null });
  });

  it('no answer yet is neither good nor bad', () => {
    expect(connectionStrength(null, ConnectionQuality.Unknown, false)).toMatchObject({ bars: 0, tone: 'unknown', label: 'Medindo conexão…' });
  });

  it('a lost or reconnecting connection shows no bars, in red', () => {
    expect(connectionStrength(40, ConnectionQuality.Lost, false)).toMatchObject({ bars: 0, tone: 'poor', label: 'Sem conexão' });
    expect(connectionStrength(40, ConnectionQuality.Excellent, true)).toMatchObject({ bars: 0, tone: 'poor', label: 'Reconectando…' });
  });
});
