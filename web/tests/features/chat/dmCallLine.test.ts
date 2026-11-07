import { describe, expect, it } from 'vitest';
import { i18n } from '@/shared/i18n/init';
import { dmCallLine, formatCallLength } from '@/features/chat/dmCallLine';

describe('formatCallLength', () => {
  const t = i18n.getFixedT('pt-BR', 'chat');

  it('keeps seconds under a minute and floors the rest', () => {
    expect(formatCallLength(1, t)).toBe('1 segundo');
    expect(formatCallLength(59, t)).toBe('59 segundos');
    expect(formatCallLength(90, t)).toBe('1 minuto');
    expect(formatCallLength(120, t)).toBe('2 minutos');
    expect(formatCallLength(3600, t)).toBe('1 hora');
    expect(formatCallLength(3720, t)).toBe('1 hora e 2 minutos');
  });
});

describe('dmCallLine', () => {
  const t = i18n.getFixedT('pt-BR', 'chat');

  it('names the caller for the other person and says Você for the caller', () => {
    expect(dmCallLine({ viewerId: 'a', callerId: 'a', callerName: 'Marcus', durationSeconds: null }, t)).toBe('Você iniciou uma chamada.');
    expect(dmCallLine({ viewerId: 'b', callerId: 'a', callerName: 'Marcus', durationSeconds: 90 }, t)).toBe('Marcus iniciou uma chamada que durou 1 minuto.');
    expect(dmCallLine({ viewerId: 'b', callerId: null, callerName: '', durationSeconds: null }, t)).toBe('Alguém iniciou uma chamada.');
  });
});
