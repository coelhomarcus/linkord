import { describe, expect, it } from 'vitest';
import { groupMentionsMe, mentionsUsername } from '@/shared/lib/mentions';

describe('mentionsUsername', () => {
  it('never matches without a username', () => {
    expect(mentionsUsername('@lune hi', null)).toBe(false);
  });

  it('detects an exact @username', () => {
    expect(mentionsUsername('hi @lune how are you?', 'lune')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(mentionsUsername('hi @Lune', 'lune')).toBe(true);
    expect(mentionsUsername('hi @lune', 'Lune')).toBe(true);
  });

  it('does not match a different username', () => {
    expect(mentionsUsername('hi @someoneelse', 'lune')).toBe(false);
  });

  it('does not match without any @', () => {
    expect(mentionsUsername('lune, how are you?', 'lune')).toBe(false);
  });
});

describe('groupMentionsMe', () => {
  it('only what the server says was notified counts, never the text', () => {
    expect(groupMentionsMe({}, ['r1'])).toBe(false);
    expect(groupMentionsMe({ mentionEveryone: true }, [])).toBe(true);
    expect(groupMentionsMe({ mentionRoleIds: ['r1'] }, ['r1', 'r2'])).toBe(true);
    expect(groupMentionsMe({ mentionRoleIds: ['r3'] }, ['r1', 'r2'])).toBe(false);
  });

  it('outside a server channel there are no groups', () => {
    expect(groupMentionsMe({ mentionEveryone: true }, null)).toBe(false);
  });
});

