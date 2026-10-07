import { initializeApp } from 'firebase/app';
import { getAuth, type User } from 'firebase/auth';
import {
  inputSchema,
  type Snapshot,
  type Entry,
  type EntryInput,
  type Change,
} from '../shared/schema';
import { demoSnapshot } from '../shared/demo';
import { ApiError, type SaveResult } from './entry-save';
export const apiBase = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};
export const auth =
  firebaseConfig.apiKey && firebaseConfig.projectId ? getAuth(initializeApp(firebaseConfig)) : null;
export interface Api {
  get<T>(path: string): Promise<T>;
  send<T>(path: string, body?: unknown, method?: string): Promise<T>;
}
export function realApi(user: User): Api {
  let cachedSnapshot: Snapshot | undefined;
  const request = async <T>(path: string, body?: unknown, method = 'GET'): Promise<T> => {
    if (!apiBase)
      throw new Error(
        '서버 주소가 아직 설정되지 않았습니다. VITE_API_BASE_URL을 설정한 뒤 다시 빌드하세요.',
      );
    let response: Response;
    try {
      response = await fetch(apiBase + '/v1' + path, {
        method,
        headers: {
          Authorization: 'Bearer ' + (await user.getIdToken()),
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(45000),
      });
    } catch {
      throw new ApiError(
        method === 'GET'
          ? '연결을 확인한 후 다시 조회해 주세요.'
          : '저장 결과를 확인하지 못했어요. 연결을 확인한 후 다시 저장해 주세요. 이전 저장 여부부터 확인합니다.',
        0,
        'connection_failed',
      );
    }
    let data;
    try {
      data = await response.json();
    } catch {
      throw new ApiError(
        '서버 응답을 읽지 못했습니다. 연결을 확인하고 다시 시도해 주세요.',
        response.ok ? 0 : response.status,
      );
    }
    if (!response.ok)
      throw new ApiError(
        data.message ?? '저장하지 못했습니다. 다시 시도하세요.',
        response.status,
        data.code,
      );
    return data as T;
  };
  return {
    get: async <T>(path: string) => {
      if (path === '/snapshot') {
        const s = await request<Snapshot & { unchanged?: boolean }>(
          path + (cachedSnapshot ? '?knownVersion=' + cachedSnapshot.version : ''),
        );
        if (s.unchanged && cachedSnapshot) return cachedSnapshot as T;
        cachedSnapshot = s;
        return s as T;
      }
      return request<T>(path);
    },
    send: (path, body, method = 'POST') => request(path, body, method),
  };
}
export function inputOf(entry: Entry): EntryInput {
  const { id, version, dataVersion, createdAt, updatedAt, deletedAt, actor, ...input } = entry;
  return input;
}
export function demoApi(): Api {
  let s = demoSnapshot();
  let history: Change[] = [];
  const requests = new Map<string, unknown>();
  const result = <T>(v: unknown) => structuredClone(v) as T;
  return {
    async get<T>(path: string): Promise<T> {
      if (path === '/snapshot') return result(s);
      if (path.startsWith('/history')) {
        const id = new URLSearchParams(path.split('?')[1]).get('id');
        return result(history.filter((h) => !id || h.entryId === id));
      }
      if (path === '/export')
        return result({
          format: 'dot-health',
          schemaVersion: 1,
          exportedAt: new Date().toISOString(),
          ...s,
          history,
        });
      if (path === '/connections') return result([]);
      if (path.startsWith('/nutrition'))
        throw new Error(
          '체험 모드에서는 외부 식품 검색을 사용하지 않습니다. 음식과 열량을 직접 입력해 보세요.',
        );
      throw new Error('체험 모드에서는 사용할 수 없는 기능입니다.');
    },
    async send<T>(path: string, body: any = {}, method = 'POST'): Promise<T> {
      if (path === '/connections') return result({ revoked: 0 });
      if (path === '/import') {
        if (s.entries.length)
          throw new Error(
            '빈 계정에서만 백업을 복원할 수 있습니다. 체험 기록은 새로고침하면 초기화됩니다.',
          );
        return result({});
      }
      if (body.requestId && requests.has(body.requestId))
        return result(requests.get(body.requestId));
      const [, , id, operation] = path.split('/'),
        before = s.entries.find((e) => e.id === id) ?? null;
      if (id && (!before || before.version !== body.expectedVersion))
        throw new Error('수정 충돌이 있습니다. 새로고침하고 다시 확인하세요.');
      if (operation === 'purge') {
        if (!before?.deletedAt || body.confirmation !== '영구 삭제')
          throw new Error('삭제 확인이 필요합니다.');
        s = { entries: s.entries.filter((e) => e.id !== id), version: s.version + 1 };
        history = history.filter((h) => h.entryId !== id);
        return result({ removed: true });
      }
      const input = body.entry ? inputSchema.parse(body.entry) : inputOf(before!);
      const at = new Date().toISOString();
      const entry: Entry = {
        ...input,
        id: id ?? crypto.randomUUID(),
        version: (before?.version ?? 0) + 1,
        dataVersion: s.version + 1,
        createdAt: before?.createdAt ?? at,
        updatedAt: at,
        deletedAt: operation === 'delete' ? at : null,
        actor: 'demo',
      };
      if (entry.kind === 'weight' && entry.representative && !entry.deletedAt)
        s.entries = s.entries.map((e) =>
          e.kind === 'weight' && e.date === entry.date && e.id !== entry.id
            ? { ...e, representative: false }
            : e,
        );
      s = {
        entries: [...s.entries.filter((e) => e.id !== entry.id), entry],
        version: s.version + 1,
      };
      history.push({
        id: crypto.randomUUID(),
        entryId: entry.id,
        at,
        actor: 'demo',
        operation: operation ?? (id ? 'update' : 'create'),
        before,
        after: entry,
        version: s.version,
      });
      const saved = { entry, version: s.version };
      if (body.requestId) requests.set(body.requestId, saved);
      return result(saved);
    },
  };
}
export function save(
  api: Api,
  input: EntryInput,
  entry?: Entry,
  requestId: string = crypto.randomUUID(),
) {
  return api.send<SaveResult>(
    entry ? '/entries/' + entry.id : '/entries',
    { entry: input, requestId, expectedVersion: entry?.version },
    entry ? 'PUT' : 'POST',
  );
}
