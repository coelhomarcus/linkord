import { describe, expect, it } from 'vitest';
import {
  ROUTES, callConversationIdFromPath, conversationIdFromPath, friendsSection, friendsView, isAwaitingOpen, isConversationsPath, isSettingsTab, modalForPath, parseFriendsView,
} from '@/shared/lib/routes';

describe('conversationIdFromPath', () => {
  it('extracts the id from a conversation link', () => {
    expect(conversationIdFromPath('/app/conversations/abc-123')).toBe('abc-123');
    expect(conversationIdFromPath('/app/conversations/abc-123/')).toBe('abc-123');
  });

  it('decodes a percent-encoded id', () => {
    expect(conversationIdFromPath(`/app/conversations/${encodeURIComponent('a b/c')}`)).toBe('a b/c');
  });

  it('is null for the route without an id and for any other page', () => {
    expect(conversationIdFromPath('/app/conversations')).toBeNull();
    expect(conversationIdFromPath('/app/friends')).toBeNull();
    expect(conversationIdFromPath('/app/conversations/a/extra')).toBeNull();
  });

  it('broken percent-encoding does not throw', () => {
    expect(conversationIdFromPath('/app/conversations/%E0%A4%A')).toBeNull();
  });
});

describe('isConversationsPath', () => {
  it('covers the list and the conversation, and nothing beyond that', () => {
    expect(isConversationsPath('/app/conversations')).toBe(true);
    expect(isConversationsPath('/app/conversations/x')).toBe(true);
    expect(isConversationsPath('/app/conversationsX')).toBe(false);
    expect(isConversationsPath('/app/friends')).toBe(false);
    expect(isConversationsPath('/app/settings/profile')).toBe(false);
  });
});

describe('isSettingsTab', () => {
  it('accepts only the known tabs', () => {
    expect(isSettingsTab('privacy')).toBe(true);
    expect(isSettingsTab('moderation')).toBe(true);
    expect(isSettingsTab('nope')).toBe(false);
    expect(isSettingsTab(undefined)).toBe(false);
  });
});

describe('conversation and call URLs', () => {
  it('encodes ids in both paths and decodes call ids', () => {
    expect(ROUTES.conversation('a b/c')).toBe('/app/conversations/a%20b%2Fc');
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
    expect(friendsView('invitations')).toBe('/app/friends?tab=invitations');
    expect(friendsView('add')).toBe('/app/friends?tab=add');
  });

  it('the search term follows the view', () => {
    expect(friendsView('online', 'ana')).toBe('/app/friends?tab=online&q=ana');
    expect(friendsView('all', 'ana')).toBe('/app/friends?q=ana');
  });

  it('Pending sections use a hash', () => {
    expect(friendsSection('received')).toBe('/app/friends?tab=pending#received');
    expect(friendsSection('sent')).toBe('/app/friends?tab=pending#sent');
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

  it('every administration page opens the admin modal', () => {
    expect(modalForPath('/admin')).toBe('admin');
    expect(modalForPath('/admin/users')).toBe('admin');
    expect(modalForPath('/admin/users/abc')).toBe('admin');
  });

  it('other pages, and look-alike paths, are not modals', () => {
    for (const path of ['/app/conversations', '/app/friends', '/app/settingsx', '/administrator', '/']) {
      expect(modalForPath(path), path).toBeNull();
    }
  });
});
