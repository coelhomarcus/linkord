/** An in-memory CacheStorage, enough for the share-target code: put, match, keys and delete by URL. */
export class FakeCacheStorage {
  private readonly stores = new Map<string, Map<string, { body: ArrayBuffer; headers: [string, string][] }>>();

  readonly entries = (name: string): string[] => [...(this.stores.get(name)?.keys() ?? [])];

  async open(name: string) {
    const store = this.stores.get(name) ?? new Map();
    this.stores.set(name, store);
    const href = (request: Request | string) => (typeof request === 'string' ? request : request.url);
    return {
      put: async (request: Request | string, response: Response) => {
        store.set(href(request), { body: await response.arrayBuffer(), headers: [...response.headers.entries()] });
      },
      match: async (request: Request | string) => {
        const entry = store.get(href(request));
        if (!entry) return undefined;
        const response = new Response(entry.body.slice(0), { headers: entry.headers });
        // Node's Blob is not jsdom's, and `new File([blob])` only keeps the latter's bytes
        return Object.assign(response, { blob: async () => new Blob([entry.body.slice(0)], { type: response.headers.get('content-type') ?? '' }) });
      },
      keys: async () => [...store.keys()].map((url) => new Request(url)),
      delete: async (request: Request | string) => store.delete(href(request)),
    };
  }

  async keys() {
    return [...this.stores.keys()];
  }

  async delete(name: string) {
    return this.stores.delete(name);
  }
}
