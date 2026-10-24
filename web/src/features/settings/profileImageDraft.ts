/** Temporary store for a cropped profile image. The blob lives here until
 * `/api/avatar` answers 201; a failed POST can retry the same bytes without
 * running ImageMagick again. */

const DB_NAME = 'profile-image-drafts';
const STORE = 'drafts';
const DB_VERSION = 1;

export interface ProfileImageDraftDriver {
  get(key: string): Promise<Blob | undefined>;
  put(key: string, blob: Blob): Promise<void>;
  del(key: string): Promise<void>;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function openDraftDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
  });
}

function createIndexedDbDriver(): ProfileImageDraftDriver {
  return {
    async get(key) {
      const db = await openDraftDb();
      try {
        const value = await requestToPromise(db.transaction(STORE, 'readonly').objectStore(STORE).get(key));
        return value instanceof Blob ? value : undefined;
      } finally {
        db.close();
      }
    },
    async put(key, blob) {
      const db = await openDraftDb();
      try {
        await requestToPromise(db.transaction(STORE, 'readwrite').objectStore(STORE).put(blob, key));
      } finally {
        db.close();
      }
    },
    async del(key) {
      const db = await openDraftDb();
      try {
        await requestToPromise(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(key));
      } finally {
        db.close();
      }
    },
  };
}

let driver: ProfileImageDraftDriver = createIndexedDbDriver();

export function setProfileImageDraftDriver(next: ProfileImageDraftDriver | null): void {
  driver = next ?? createIndexedDbDriver();
}

export function profileImageDraftKey(file: Blob, crop: { x: number; y: number; width: number; height: number }): string {
  const name = file instanceof File ? file.name : '';
  const modified = file instanceof File ? file.lastModified : 0;
  return [
    file.size,
    file.type,
    name,
    modified,
    Math.round(crop.x),
    Math.round(crop.y),
    Math.round(crop.width),
    Math.round(crop.height),
  ].join(':');
}

export function getProfileImageDraft(key: string): Promise<Blob | undefined> {
  return driver.get(key);
}

export function putProfileImageDraft(key: string, blob: Blob): Promise<void> {
  return driver.put(key, blob);
}

export function deleteProfileImageDraft(key: string): Promise<void> {
  return driver.del(key);
}
