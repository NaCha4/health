import type { Firestore, Transaction } from 'firebase-admin/firestore';
export interface QueryOptions {
  field?: string;
  equals?: unknown;
  limit?: number;
}
export interface Tx {
  get<T>(path: string): Promise<T | null>;
  list<T>(path: string, options?: QueryOptions): Promise<T[]>;
  set(path: string, value: unknown): void;
  remove(path: string): void;
}
export interface Store {
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}
const clean = (v: unknown) => JSON.parse(JSON.stringify(v));
export class MemoryStore implements Store {
  private docs = new Map<string, unknown>();
  private queue: Promise<unknown> = Promise.resolve();
  async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const job = this.queue.then(async () => {
      const copy = new Map(this.docs);
      const tx: Tx = {
        get: async <T>(path: string) => (copy.has(path) ? clean(copy.get(path)) : null) as T | null,
        list: async <T>(path: string, o: QueryOptions = {}) =>
          [...copy]
            .filter(
              ([k, v]) =>
                k.startsWith(path + '/') &&
                !k.slice(path.length + 1).includes('/') &&
                (!o.field || (v as Record<string, unknown>)[o.field] === o.equals),
            )
            .slice(0, o.limit ?? 10001)
            .map(([, v]) => clean(v)) as T[],
        set: (p, v) => {
          copy.set(p, clean(v));
        },
        remove: (p) => {
          copy.delete(p);
        },
      };
      const value = await fn(tx);
      this.docs = copy;
      return value;
    });
    this.queue = job.catch(() => {});
    return job;
  }
}
export class FirestoreStore implements Store {
  constructor(private db: Firestore) {}
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.runTransaction(async (t: Transaction) =>
      fn({
        get: async <V>(p: string) => {
          const s = await t.get(this.db.doc(p));
          return s.exists ? (s.data() as V) : null;
        },
        list: async <V>(p: string, o: QueryOptions = {}) => {
          let q: FirebaseFirestore.Query = this.db.collection(p);
          if (o.field) q = q.where(o.field, '==', o.equals);
          const s = await t.get(q.limit(o.limit ?? 10001));
          return s.docs.map((d) => d.data() as V);
        },
        set: (p, v) => {
          t.set(this.db.doc(p), clean(v));
        },
        remove: (p) => {
          t.delete(this.db.doc(p));
        },
      }),
    );
  }
}
