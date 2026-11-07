import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatCallLength } from '../../../src/modules/calls/callLength.js';

describe('formatCallLength', () => {
  it('keeps seconds under a minute and floors the rest', () => {
    assert.equal(formatCallLength(1, 'pt-BR'), '1 segundo');
    assert.equal(formatCallLength(59, 'pt-BR'), '59 segundos');
    assert.equal(formatCallLength(90, 'pt-BR'), '1 minuto');
    assert.equal(formatCallLength(120, 'en-US'), '2 minutes');
    assert.equal(formatCallLength(3600, 'pt-BR'), '1 hora');
    assert.equal(formatCallLength(3720, 'pt-BR'), '1 hora e 2 minutos');
  });
});
