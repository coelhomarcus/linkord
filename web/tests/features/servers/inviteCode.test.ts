import { describe, expect, it } from 'vitest';
import { inviteCodeFromLink, inviteCodesInText, parseInviteCode } from '@/features/servers/inviteCode';

const origin = 'https://linkord.app';

describe('invite codes', () => {
  it('reads a pasted link or a bare code', () => {
    expect(parseInviteCode('https://linkord.app/invite/abc123')).toBe('abc123');
    expect(parseInviteCode('  abc123 ')).toBe('abc123');
    expect(parseInviteCode('not a code!')).toBeNull();
  });

  it('only links to this instance count', () => {
    expect(inviteCodeFromLink('https://linkord.app/invite/abc123', origin)).toBe('abc123');
    expect(inviteCodeFromLink('https://evil.example/invite/abc123', origin)).toBeNull();
    expect(inviteCodeFromLink('https://linkord.app/invite/abc123/extra', origin)).toBeNull();
  });

  it('finds each distinct invite in a message, trailing punctuation aside', () => {
    const text = 'entra aí: https://linkord.app/invite/abc123. ou https://linkord.app/invite/xyz789, https://linkord.app/invite/abc123 https://other.app/invite/nope1';
    expect(inviteCodesInText(text, origin)).toEqual(['abc123', 'xyz789']);
    expect(inviteCodesInText('sem convite aqui', origin)).toEqual([]);
  });
});
