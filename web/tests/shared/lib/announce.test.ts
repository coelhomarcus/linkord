import { afterEach, describe, expect, it, vi } from 'vitest';
import { announce } from '@/shared/lib/announce';
import { liveAnnouncements } from '@tests/fixtures/announcerFixture';

const region = () => document.querySelector<HTMLElement>('[data-live-announcer]');

describe('announce', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('has one polite live region on the page before anything is said', () => {
    expect(document.querySelectorAll('[data-live-announcer]')).toHaveLength(1);
    expect(region()).toHaveAttribute('aria-live', 'polite');
    expect(region()).not.toHaveAttribute('role');
    expect(region()!.parentElement).toBe(document.body);
    expect(liveAnnouncements()).toEqual([]);
  });

  it('says the same words twice in a row as two messages', () => {
    announce('Copiado');
    announce('Copiado');
    expect(liveAnnouncements()).toEqual(['Copiado', 'Copiado']);
  });

  it('lets a message go once a screen reader has had time to read it', () => {
    vi.useFakeTimers();
    announce('Copiado');
    vi.advanceTimersByTime(6999);
    expect(liveAnnouncements()).toEqual(['Copiado']);
    vi.advanceTimersByTime(1);
    expect(liveAnnouncements()).toEqual([]);
  });

  it('puts the region back if something removed it', () => {
    region()!.remove();
    announce('Copiado');
    expect(region()).toHaveAttribute('aria-live', 'polite');
    expect(liveAnnouncements()).toEqual(['Copiado']);
  });
});
