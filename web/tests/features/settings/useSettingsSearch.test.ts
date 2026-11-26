import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { normalizeSearchText, useSettingsSearch } from '@/features/settings/useSettingsSearch';
import { useLanguageForTests } from '@tests/fixtures/i18nFixture';

function titles(results: ReturnType<typeof useSettingsSearch>['results']): string[] {
  return results.map((r) => r.title);
}

describe('normalizeSearchText', () => {
  it('strips accents, ignores case, and trims edge whitespace', () => {
    expect(normalizeSearchText('  Câmera  ')).toBe('camera');
    expect(normalizeSearchText('ÁUDIO')).toBe('audio');
  });
});

describe('useSettingsSearch', () => {
  it('an empty query returns nothing (it is not a full listing)', () => {
    const { result } = renderHook(() => useSettingsSearch());
    expect(result.current.results).toEqual([]);
  });

  it('"camera" (no accent) finds the video section through its synonym "câmera"', () => {
    const { result } = renderHook(() => useSettingsSearch());
    act(() => result.current.setQuery('camera'));
    expect(titles(result.current.results)).toContain('Vídeo');
  });

  it('"12 horas" finds the time format, under Idioma e hora', () => {
    const { result } = renderHook(() => useSettingsSearch());
    act(() => result.current.setQuery('12 horas'));
    const found = result.current.results.find((r) => r.title === 'Formato de tempo');
    expect(found?.categoryLabel).toBe('Idioma e hora');
    expect(found?.entry).toMatchObject({ categoryId: 'language', sectionId: 'time-format' });
  });

  it('"github" finds Conexões via synonym (no sectionId)', () => {
    const { result } = renderHook(() => useSettingsSearch());
    act(() => result.current.setQuery('github'));
    expect(titles(result.current.results)).toContain('Conexões');
    expect(result.current.results.find((r) => r.title === 'Conexões')?.entry.sectionId).toBeUndefined();
  });

  it('"som" finds Sons and/or Alto-falante', () => {
    const { result } = renderHook(() => useSettingsSearch());
    act(() => result.current.setQuery('som'));
    const found = titles(result.current.results);
    expect(found.some((t) => t === 'Sons' || t === 'Alto-falante')).toBe(true);
  });

  it('empty result for something that does not exist', () => {
    const { result } = renderHook(() => useSettingsSearch());
    act(() => result.current.setQuery('xyzxyzxyz'));
    expect(result.current.results).toEqual([]);
  });

  it('does not include administration in settings search', () => {
    const { result } = renderHook(useSettingsSearch);
    act(() => result.current.setQuery('admin'));
    expect(titles(result.current.results)).not.toContain('Administração');
  });
});

describe('useSettingsSearch downloads', () => {
  it('finds both ways to install under the downloads tab, on every browser', () => {
    const { result } = renderHook(() => useSettingsSearch());
    act(() => result.current.setQuery('instalar'));
    expect(result.current.results.find((r) => r.title === 'Web app')?.entry).toMatchObject({ categoryId: 'downloads', sectionId: 'web-app' });

    act(() => result.current.setQuery('windows'));
    expect(result.current.results.find((r) => r.title === 'App para Windows')?.entry).toMatchObject({ categoryId: 'downloads', sectionId: 'windows-app' });
  });
});

describe('useSettingsSearch in English', () => {
  useLanguageForTests('en-US');

  it('searches the English titles and synonyms', () => {
    const { result } = renderHook(() => useSettingsSearch());
    act(() => result.current.setQuery('webcam'));
    expect(titles(result.current.results)).toContain('Video');
    act(() => result.current.setQuery('alto-falante'));
    expect(result.current.results).toEqual([]);
  });
});
