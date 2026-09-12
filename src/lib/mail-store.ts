"use client";

/**
 * The local copy. IndexedDB on this device holds mail lists, opened threads and folder data so folder switches,
 * opening a message and search are instant, the way Outlook's local database works. Nothing here touches our
 * servers; it is cleared on sign-out or from Settings. Gmail push keeps it current through the live sync signal.
 */
const DB = "happydays-mail";
const VERSION = 2;
type ListRecord = { key: string; items: unknown[]; nextToken?: string; missing: number; fetchedAt: number };
type ThreadRecord = { id: string; data: unknown; text: string; fetchedAt: number };

let dbPromise: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB unavailable"));
  if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => { const d = req.result; for (const name of Array.from(d.objectStoreNames)) d.deleteObjectStore(name); if (!d.objectStoreNames.contains("lists")) d.createObjectStore("lists", { keyPath: "key" }); if (!d.objectStoreNames.contains("threads")) d.createObjectStore("threads", { keyPath: "id" }); if (!d.objectStoreNames.contains("meta")) d.createObjectStore("meta", { keyPath: "key" }); };
    req.onsuccess = () => { req.result.onversionchange = () => { req.result.close(); dbPromise = null; }; resolve(req.result); };
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}
const tx = async <T,>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
  const d = await db();
  return new Promise<T>((resolve, reject) => { const transaction = d.transaction(store, mode); const r = fn(transaction.objectStore(store)); transaction.oncomplete = () => resolve(r.result); transaction.onabort = transaction.onerror = () => reject(transaction.error); });
};

/** Searchable text for the device copy: subject, people, then bodies. */
export const threadText = (t: { subject: string; messages: Array<{ from: { name: string; email: string }; to: Array<{ email: string }>; text?: string; snippet: string }> }) => [t.subject, ...t.messages.flatMap((m) => [m.from.name, m.from.email, ...m.to.map((a) => a.email), m.text ?? m.snippet])].join("\n");

export const mailStore = {
  async getList<T>(key: string): Promise<{ items: T[]; nextToken?: string; missing: number; fetchedAt: number } | undefined> { try { const r = await tx<ListRecord | undefined>("lists", "readonly", (s) => s.get(key) as IDBRequest<ListRecord | undefined>); return r ? { items: r.items as T[], nextToken: r.nextToken, missing: r.missing, fetchedAt: r.fetchedAt } : undefined; } catch { return undefined; } },
  async getLists(prefix: string): Promise<ListRecord[]> {
    try { return await tx<ListRecord[]>("lists", "readonly", s => s.getAll(IDBKeyRange.bound(prefix, prefix + "\uffff"))); } catch { return []; }
  },
  async putList(key: string, v: { items: unknown[]; nextToken?: string; missing: number; fetchedAt: number }) { try { await tx("lists", "readwrite", (s) => s.put({ key, ...v })); } catch { /* storage full or blocked */ } },
  async getThread<T>(id: string): Promise<{ data: T; fetchedAt: number } | undefined> { try { const r = await tx<ThreadRecord | undefined>("threads", "readonly", (s) => s.get(id) as IDBRequest<ThreadRecord | undefined>); return r ? { data: r.data as T, fetchedAt: r.fetchedAt } : undefined; } catch { return undefined; } },
  async putThread(id: string, data: unknown, text: string) { try { await tx("threads", "readwrite", (s) => s.put({ id, data, text: text.slice(0, 20_000), fetchedAt: Date.now() })); } catch { /* ignore */ } },
  async deleteThread(id: string) { try { await tx("threads", "readwrite", (s) => s.delete(id)); } catch { /* ignore */ } },
  async hasThread(id: string) { try { return (await tx<number>("threads", "readonly", (s) => s.count(id))) > 0; } catch { return false; } },
  /** Local search over everything stored: subject, participants and body text. */
  async search(q: string, limit = 40, scope = ""): Promise<Array<{ id: string; score: number; text: string }>> {
    const needle = q.trim().toLowerCase(); if (needle.length < 2) return [];
    const terms = needle.split(/\s+/).filter(Boolean);
    try {
      const all = await tx<ThreadRecord[]>("threads", "readonly", (s) => s.getAll() as IDBRequest<ThreadRecord[]>);
      const hits: Array<{ id: string; score: number; text: string }> = [];
      for (const r of all) { if (!scope || !r.id.startsWith(scope)) continue; const hay = r.text.toLowerCase(); let score = 0; for (const t of terms) { const i = hay.indexOf(t); if (i === -1) { score = 0; break; } score += i < 200 ? 3 : 1; } if (score) hits.push({ id: r.id.slice(scope.length), score, text: r.text }); }
      return hits.sort((a, b) => b.score - a.score).slice(0, limit);
    } catch { return []; }
  },
  async stats(): Promise<{ threads: number; lists: number; bytes?: number }> {
    try { const [threads, lists] = await Promise.all([tx<number>("threads", "readonly", (s) => s.count()), tx<number>("lists", "readonly", (s) => s.count())]); const est = await navigator.storage?.estimate?.(); return { threads, lists, bytes: est?.usage }; } catch { return { threads: 0, lists: 0 }; }
  },
  async clear() { try { await Promise.all(["lists", "threads", "meta"].map(n => tx(n, "readwrite", s => s.clear()))); } catch { /* storage unavailable */ } },
  /** Drop bodies older than 60 days so the store doesn't grow without bound. */
  async prune(maxAgeMs = 60 * 86_400_000) {
    try { const d = await db(); const s = d.transaction("threads", "readwrite").objectStore("threads"); const cutoff = Date.now() - maxAgeMs; const req = s.openCursor(); req.onsuccess = () => { const c = req.result; if (!c) return; const v = c.value as ThreadRecord; if (v.fetchedAt < cutoff) c.delete(); c.continue(); }; } catch { /* ignore */ }
  },
};

/** Capture the signed-in account with each async operation, including writes that finish after sign-out. */
export function scopedMailStore(scope: string) {
  const prefix = `${scope}::`;
  return {
    getLists: async () => (await mailStore.getLists(prefix)).map(r => ({ ...r, key: r.key.slice(prefix.length) })),
    getList: <T,>(key: string) => mailStore.getList<T>(prefix + key),
    putList: (key: string, value: Parameters<typeof mailStore.putList>[1]) => mailStore.putList(prefix + key, value),
    getThread: <T,>(id: string) => mailStore.getThread<T>(prefix + id),
    putThread: (id: string, data: unknown, text: string) => mailStore.putThread(prefix + id, data, text),
    search: (q: string, limit?: number) => mailStore.search(q, limit, prefix),
    async invalidate(completed: string[], removeBodies: boolean, update?: (key: string, items: unknown[]) => unknown[]) {
      try {
        const lists = await mailStore.getLists(prefix);
        await Promise.all(lists.map(r => update
          ? tx("lists", "readwrite", s => s.put({ ...r, items: update(r.key.slice(prefix.length), r.items), fetchedAt: 0 }))
          : tx("lists", "readwrite", s => s.delete(r.key))));
        if (removeBodies) await Promise.all(completed.map(id => mailStore.deleteThread(prefix + id)));
      } catch { /* local cache unavailable */ }
    },
  };
}
