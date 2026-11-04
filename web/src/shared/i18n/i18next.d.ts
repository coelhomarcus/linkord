import 'i18next';
import type common from './locales/pt-BR.json';
import type auth from '@/features/auth/locales/pt-BR.json';
import type chat from '@/features/chat/locales/pt-BR.json';
import type conversations from '@/features/conversations/locales/pt-BR.json';
import type friends from '@/features/friends/locales/pt-BR.json';
import type gifs from '@/features/gifs/locales/pt-BR.json';
import type navigation from '@/features/navigation/locales/pt-BR.json';
import type notifications from '@/features/notifications/locales/pt-BR.json';
import type calls from '@/features/calls/locales/pt-BR.json';
import type profile from '@/features/profile/locales/pt-BR.json';
import type media from '@/features/media/locales/pt-BR.json';
import type reports from '@/features/reports/locales/pt-BR.json';
import type bots from '@/features/bots/locales/pt-BR.json';
import type admin from '@/features/admin/locales/pt-BR.json';
import type settings from '@/features/settings/locales/pt-BR.json';
import type soundboard from '@/features/soundboard/locales/pt-BR.json';
import type servers from '@/features/servers/locales/pt-BR.json';

// pt-BR is the source of truth for key names: other languages are checked
// against it by tests/shared/i18n/localeParity.test.ts. A feature that moves
// to i18n adds its namespace to `resources` below.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: {
      common: typeof common;
      auth: typeof auth;
      chat: typeof chat;
      conversations: typeof conversations;
      friends: typeof friends;
      gifs: typeof gifs;
      navigation: typeof navigation;
      notifications: typeof notifications;
      calls: typeof calls;
      profile: typeof profile;
      media: typeof media;
      reports: typeof reports;
      bots: typeof bots;
      admin: typeof admin;
      settings: typeof settings;
      soundboard: typeof soundboard;
      servers: typeof servers;
    };
  }
}
