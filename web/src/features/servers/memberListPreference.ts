import { LOCAL_STORAGE_KEYS, localStorageStore } from '@/shared/lib/localStorage';

/** The member list is visible by default until the user changes the toggle. */
export function loadMemberListOpen(): boolean {
  return localStorageStore.get(LOCAL_STORAGE_KEYS.memberListOpen) !== '0';
}

export function saveMemberListOpen(value: boolean): void {
  localStorageStore.set(LOCAL_STORAGE_KEYS.memberListOpen, value ? '1' : '0');
}
