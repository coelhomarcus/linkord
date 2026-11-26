import { describe, expect, it } from 'vitest';
import {
  ROUTES, callConversationIdFromPath, conversationIdFromPath, conversationPath, friendsSection, friendsView, inviteCodeFromPath, isAwaitingOpen, isDesktopLinkPath, isHomePath, isSettingsTab, messageIdFromSearch, modalForPath, parseFriendsView, serverIdFromPath,
} from '@/shared/lib/routes';

describe('conversationIdFromPath', () => {
  it('extracts the conversation from a DM or a channel link', () => {
    expect(conversationIdFromPath('/app/channels/@me/abc-123')).toBe('abc-123');
    expect(conversationIdFromPath('/app/channels/srv/chan/')).toBe('chan');
  });

  it('decodes a percent-encoded id', () => {
    expect(conversationIdFromPath(`/app/channels/@me/${encodeURIComponent('a b/c')}`)).toBe('a b/c');
  });

  it('is null for home, a bare server and any other page', () => {
    expect(conversationIdFromPath('/app/channels/@me')).toBeNull();
    expect(conversationIdFromPath('/app/channels/srv')).toBeNull();
    expect(conversationIdFromPath('/app/friends')).toBeNull();
    expect(conversationIdFromPath('/app/channels/a/b/extra')).toBeNull();
  });

  it('broken percent-encoding does not throw', () => {
    expect(conversationIdFromPath('/app/channels/@me/%E0%A4%A')).toBeNull();
  });
});

describe('serverIdFromPath and isHomePath', () => {
  it('names the server, never home', () => {
    expect(serverIdFromPath('/app/channels/srv')).toBe('srv');
    expect(serverIdFromPath('/app/channels/srv/chan')).toBe('srv');
    expect(serverIdFromPath('/app/channels/@me/dm')).toBeNull();
    expect(serverIdFromPath('/app/friends')).toBeNull();
  });

  it('home is the DMs and the friends page', () => {
    expect(isHomePath('/app/channels/@me')).toBe(true);
    expect(isHomePath('/app/channels/@me/dm')).toBe(true);
    expect(isHomePath('/app/friends')).toBe(true);
    expect(isHomePath('/app/channels/srv/chan')).toBe(false);
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
    expect(isDesktopLinkPath(`/app/channels/@me/${id}`)).toBe(true);
    expect(isDesktopLinkPath(`/app/channels/${id}/${id}?message=42`)).toBe(true);
  });

  it('refuses every other path of the app and anything off it', () => {
    for (const path of [
      '/app/settings/account', '/admin/users', '/invite/ab', '/invite/abcd/..', '//evil.example/invite/abcd',
      'https://evil.example/invite/abcd', `/app/channels/@me/${id}?next=/admin`, `/app/channels/@me/${id}#x`,
      `/app/channels/@me/..`, `/app/channels/@me/${id}/extra`, '',
    ]) expect(isDesktopLinkPath(path), path).toBe(false);
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
    expect(conversationPath({ id: 'a b/c', serverId: null })).toBe('/app/channels/@me/a%20b%2Fc');
    expect(conversationPath({ id: 'c', serverId: 's' })).toBe('/app/channels/s/c');
    expect(ROUTES.call('a b/c')).toBe('/app/calls/a%20b%2Fc');
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
    expect(friendsView('all')).toBe('/app/friends');
    expect(friendsView('online')).toBe('/app/friends?tab=online');
    expect(friendsView('pending')).toBe('/app/friends?tab=pending');
    expect(friendsView('add')).toBe('/app/friends?tab=add');
  });

  it('the search term follows the view', () => {
    expect(friendsView('online', 'ana')).toBe('/app/friends?tab=online&q=ana');
    expect(friendsView('all', 'ana')).toBe('/app/friends?q=ana');
  });

  it('Pending sections use a hash', () => {
    expect(friendsSection('received')).toBe('/app/friends?tab=pending#received');
    expect(friendsSection('sent')).toBe('/app/friends?tab=pending#sent');
    expect(friendsSection('invitations')).toBe('/app/friends?tab=pending#invitations');
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
    expect(modalForPath('/app/settings')).toBe('settings');
    expect(modalForPath('/app/settings/av')).toBe('settings');
  });

  it('does not open a modal for retired administration routes', () => {
    for (const path of ['/admin', '/admin/users', '/admin/users/abc']) {
      expect(modalForPath(path), path).toBeNull();
    }
  });

  it('other pages, and look-alike paths, are not modals', () => {
    for (const path of ['/app/conversations', '/app/friends', '/app/settingsx', '/administrator', '/']) {
      expect(modalForPath(path), path).toBeNull();
    }
  });
});
