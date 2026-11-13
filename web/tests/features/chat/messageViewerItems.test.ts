import { describe, expect, it } from 'vitest';
import { messageViewerItems } from '@/features/chat/messageViewerItems';
import type { LinkPreviewData } from '@/shared/api/api';
import type { ChatAttachment } from '@/shared/types/protocol';

const preview = (overrides: Partial<LinkPreviewData>): LinkPreviewData => ({
  url: '', title: null, description: null, image: null, video: null, favicon: null, siteName: 'site', themeColor: null, ...overrides,
});
const file = (id: string, mime: string): ChatAttachment => ({ id, name: id, mime, size: 1 });
const none = () => undefined;

describe('messageViewerItems', () => {
  it('orders a message as it is drawn: card pictures, then pictures, then videos', () => {
    const items = messageViewerItems({
      text: 'olha https://fotos.example/album',
      embeds: [preview({ url: 'https://fotos.example/album', title: 'Álbum', image: '/api/media-proxy/p/1', images: ['/api/media-proxy/p/1', '/api/media-proxy/p/2'] })],
      attachments: [file('clip.mp4', 'video/mp4'), file('doc.pdf', 'application/pdf'), file('a.png', 'image/png')],
    }, none);
    expect(items.map((item) => item.key)).toEqual([
      'embed:https://fotos.example/album#0',
      'embed:https://fotos.example/album#1',
      'att:a.png',
      'att:clip.mp4',
    ]);
    expect(items[0]).toMatchObject({ name: 'Álbum', kind: 'image' });
    expect(items[3]).toMatchObject({ kind: 'video', attachmentId: 'clip.mp4' });
  });

  it('uses a preview fetched after the message arrived', () => {
    const cached = preview({ url: 'https://x.example/a.png', image: '/api/media-proxy/x' });
    const items = messageViewerItems({ text: 'https://x.example/a.png' }, (url) => (url === cached.url ? cached : undefined));
    expect(items).toEqual([expect.objectContaining({ key: 'embed:https://x.example/a.png#0', src: '/api/media-proxy/x', name: 'a.png' })]);
  });

  it('leaves out players, external videos, removed cards and cards under a spoiler', () => {
    const items = messageViewerItems({
      text: 'https://youtu.be/dQw4w9WgXcQ https://v.example/a.mp4 https://page.example/video https://gone.example/a ||https://secret.example/a||',
      suppressedEmbeds: ['https://gone.example/a'],
      embeds: [
        preview({ url: 'https://youtu.be/dQw4w9WgXcQ', image: '/api/media-proxy/yt' }),
        preview({ url: 'https://page.example/video', image: '/api/media-proxy/poster', video: 'https://page.example/v.mp4' }),
        preview({ url: 'https://gone.example/a', image: '/api/media-proxy/gone' }),
        preview({ url: 'https://secret.example/a', image: '/api/media-proxy/secret' }),
      ],
    }, none);
    expect(items).toEqual([]);
  });

  it('a GIF message is its GIF', () => {
    const url = 'https://static.klipy.com/ii/abc/def.gif';
    expect(messageViewerItems({ text: url }, none)).toEqual([expect.objectContaining({ key: `gif:${url}`, kind: 'gif', animated: true })]);
  });
});
