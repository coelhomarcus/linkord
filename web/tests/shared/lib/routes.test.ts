import { describe, expect, it } from 'vitest';
import {
  ROUTES, callConversationIdFromPath, conversationIdFromPath, conversationPath, friendsSection, friendsView, inAppPath, inviteCodeFromPath, isAwaitingOpen, isDesktopLinkPath, isHomePath, isSettingsTab, messageIdFromSearch, modalForPath, parseFriendsView, serverIdFromPath,
  withoutLegacyAppPrefix,
} from '@/shared/lib/routes';

describe('conversationIdFromPath', () => {
  it('extracts the conversation from a DM or a channel link', () => {
    expect(conversationIdFromPath('/channels/@me/abc-123')).toBe('abc-123');
    expect(conversationIdFromPath('/channels/srv/chan/')).toBe('chan');
  });

  it('decodes a percent-encoded id', () => {
    expect(conversationIdFromPath(`/channels/@me/${encodeURIComponent('a b/c')}`)).toBe('a b/c');
  });

  it('is null for home, a bare server and any other page', () => {
    expect(conversationIdFromPath('/channels/@me')).toBeNull();
    expect(conversationIdFromPath('/channels/srv')).toBeNull();
    expect(conversationIdFromPath('/friends')).toBeNull();
    expect(conversationIdFromPath('/channels/a/b/extra')).toBeNull();
  });

  it('broken percent-encoding does not throw', () => {
    expect(conversationIdFromPath('/channels/@me/%E0%A4%A')).toBeNull();
  });
});

describe('serverIdFromPath and isHomePath', () => {
  it('names the server, never home', () => {
    expect(serverIdFromPath('/channels/srv')).toBe('srv');
    expect(serverIdFromPath('/channels/srv/chan')).toBe('srv');
    expect(serverIdFromPath('/channels/@me/dm')).toBeNull();
    expect(serverIdFromPath('/friends')).toBeNull();
  });

  it('home is the DMs and the friends page', () => {
    expect(isHomePath('/channels/@me')).toBe(true);
    expect(isHomePath('/channels/@me/dm')).toBe(true);
    expect(isHomePath('/friends')).toBe(true);
    expect(isHomePath('/channels/srv/chan')).toBe(false);
  });
});

describe('inviteCodeFromPath', () => {
  it('reads the code of an invite link', () => {
    expect(inviteCodeFromPath('/invite/hTKzmak')).toBe('hTKzmak');
    expect(inviteCodeFromPath('/invite')).toBeNull();
  });
});

describe('messageIdFromSearch', () => {
  it('reads a positive message id', () => {
    expect(messageIdFromSearch('?message=42')).toBe(42);
    expect(messageIdFromSearch('?x=1&message=7')).toBe(7);
  });

  it('is null without one or with anything that is not a msgId', () => {
    for (const search of ['', '?message=', '?message=0', '?message=-1', '?message=1e3', '?message=abc', '?message=1234567890123456']) {
      expect(messageIdFromSearch(search)).toBeNull();
    }
  });
});

describe('isDesktopLinkPath', () => {
  const id = '0b6f3c1e-2d4a-4c8e-9f10-1a2b3c4d5e6f';

  it('accepts an invite and a conversation, optionally at a message', () => {
    expect(isDesktopLinkPath('/invite/aB3dEf7h')).toBe(true);
    expect(isDesktopLinkPath(`/channels/@me/${id}`)).toBe(true);
    expect(isDesktopLinkPath(`/channels/${id}/${id}?message=42`)).toBe(true);
  });

  it('refuses every other path of the app and anything off it', () => {
    for (const path of [
      '/settings/account', '/admin/users', '/invite/ab', '/invite/abcd/..', '//evil.example/invite/abcd',
      'https://evil.example/invite/abcd', `/channels/@me/${id}?next=/admin`, `/channels/@me/${id}#x`,
      `/channels/@me/..`, `/channels/@me/${id}/extra`, '',
    ]) expect(isDesktopLinkPath(path), path).toBe(false);
  });
});

describe('legacy /app paths', () => {
  it('drops the old prefix and keeps the query and hash', () => {
    expect(withoutLegacyAppPrefix('/app/friends?tab=pending#received')).toBe('/friends?tab=pending#received');
    expect(withoutLegacyAppPrefix('/app')).toBe('/');
    expect(withoutLegacyAppPrefix('/app?x=1')).toBe('/?x=1');
    expect(withoutLegacyAppPrefix('/apple')).toBe('/apple');
    expect(withoutLegacyAppPrefix('/friends')).toBe('/friends');
    expect(withoutLegacyAppPrefix('/app//evil.example')).toBe('/evil.example');
    expect(withoutLegacyAppPrefix('/app/\\evil.example')).toBe('/evil.example');
  });

  it('takes a page of the app, old or new, and refuses anything that leaves it', () => {
    expect(inAppPath('/friends?tab=pending#invitations')).toBe('/friends?tab=pending#invitations');
    expect(inAppPath('/app/channels/@me/c1')).toBe('/channels/@me/c1');
    // a doubled slash after the old prefix stays a path on this origin
    expect(inAppPath('/app//evil.example')).toBe('/evil.example');
    for (const path of ['https://evil.example/friends', '//evil.example', '/\\evil.example', '/api/me', '/uploads/x', '/app/admin', '/friends/../api/me', 'friends', '']) {
      expect(inAppPath(path), path).toBeNull();
    }
  });
});

describe('isSettingsTab', () => {
  it('accepts only the known tabs', () => {
    expect(isSettingsTab('privacy')).toBe(true);
    expect(isSettingsTab('moderation')).toBe(false);
    expect(isSettingsTab('administration')).toBe(false);
    expect(isSettingsTab('nope')).toBe(false);
    expect(isSettingsTab(undefined)).toBe(false);
  });
});

describe('conversation and call URLs', () => {
  it('encodes ids in both paths and decodes call ids', () => {
    expect(conversationPath({ id: 'a b/c', serverId: null })).toBe('/channels/@me/a%20b%2Fc');
    expect(conversationPath({ id: 'c', serverId: 's' })).toBe('/channels/s/c');
    expect(ROUTES.call('a b/c')).toBe('/calls/a%20b%2Fc');
    expect(callConversationIdFromPath(ROUTES.call('a b/c'))).toBe('a b/c');
    expect(callConversationIdFromPath(ROUTES.friends)).toBeNull();
  });
});

describe('isAwaitingOpen', () => {
  it('reads the flag from navigation state, without trusting any shape', () => {
    expect(isAwaitingOpen({ awaitingOpen: true })).toBe(true);
    expect(isAwaitingOpen({ awaitingOpen: 'yes' })).toBe(false);
    expect(isAwaitingOpen(null)).toBe(false);
    expect(isAwaitingOpen('x')).toBe(false);
  });
});

describe('Friends routes', () => {
  it('All is the route with no query; the other views use ?tab=', () => {
    expect(friendsView('all')).toBe('/friends');
    expect(friendsView('online')).toBe('/friends?tab=online');
    expect(friendsView('pending')).toBe('/friends?tab=pending');
    expect(friendsView('add')).toBe('/friends?tab=add');
  });

  it('the search term follows the view', () => {
    expect(friendsView('online', 'ana')).toBe('/friends?tab=online&q=ana');
    expect(friendsView('all', 'ana')).toBe('/friends?q=ana');
  });

  it('Pending sections use a hash', () => {
    expect(friendsSection('received')).toBe('/friends?tab=pending#received');
    expect(friendsSection('sent')).toBe('/friends?tab=pending#sent');
    expect(friendsSection('invitations')).toBe('/friends?tab=pending#invitations');
  });

  it('an unknown or missing value falls back to All', () => {
    expect(parseFriendsView(null)).toBe('all');
    expect(parseFriendsView('garbage')).toBe('all');
    expect(parseFriendsView('')).toBe('all');
    expect(parseFriendsView('pending')).toBe('pending');
    expect(parseFriendsView('add')).toBe('add');
  });
});

describe('modalForPath', () => {
  it('settings and its tabs open the settings modal', () => {
    expect(modalForPath('/settings')).toBe('settings');
    expect(modalForPath('/settings/av')).toBe('settings');
  });

  it('does not open a modal for retired administration routes', () => {
    for (const path of ['/admin', '/admin/users', '/admin/users/abc']) {
      expect(modalForPath(path), path).toBeNull();
    }
  });

  it('other pages, and look-alike paths, are not modals', () => {
    for (const path of ['/conversations', '/friends', '/settingsx', '/administrator', '/']) {
      expect(modalForPath(path), path).toBeNull();
    }
  });
});
