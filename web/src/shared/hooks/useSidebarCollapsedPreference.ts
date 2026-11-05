
import { LOCAL_STORAGE_KEYS, localStorageStore } from '@/shared/lib/localStorage';

export function loadSidebarCollapsed(): boolean {
  return localStorageStore.get(LOCAL_STORAGE_KEYS.sidebarCollapsed) === '1';
}

export function saveSidebarCollapsed(value: boolean): void {
  localStorageStore.set(LOCAL_STORAGE_KEYS.sidebarCollapsed, value ? '1' : '0');
}
