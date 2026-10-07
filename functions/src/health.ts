import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  inputSchema,
  type Entry,
  type EntryInput,
  type Snapshot,
  type Change,
} from '../../shared/schema.js';
import { isFutureOccurrence, today } from '../../shared/dates.js';
import type { Store, Tx } from './store.js';
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const requestSchema = z
  .string()
  .min(8)
  .max(150)
  .regex(/^[A-Za-z0-9:_-]+$/);
function stable(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v && typeof v === 'object')
    return (
      '{' +
      Object.entries(v)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, x]) => JSON.stringify(k) + ':' + stable(x))
        .join(',') +
      '}'
    );
  return JSON.stringify(v);
}
export class HealthService {
  constructor(
    public store: Store,
    private now = () => new Date(),
  ) {}
  root(uid: string) {
    return `users/${idSchema.parse(uid)}`;
  }
  async currentVersion(uid: string) {
    return this.store.transaction(async (tx) => {
      const meta = await tx.get<{ version: number; importing?: string }>(this.root(uid));
      if (meta?.importing)
        throw new AppError(
          409,
          'restore_in_progress',
          '백업 복원 중입니다. 같은 파일로 복원을 완료하세요.',
        );
      return meta?.version ?? 0;
    });
  }
  async snapshot(uid: string): Promise<Snapshot> {
    const root = this.root(uid);
    return this.store.transaction(async (tx) => {
      const meta = await tx.get<{ version: number }>(root);
      if ((meta as { importing?: string })?.importing)
        throw new AppError(
          409,
          'restore_in_progress',
          '백업 복원 중입니다. 같은 파일로 복원을 완료해 주세요.',
        );
      const entries = await tx.list<Entry>(root + '/entries');
      if (entries.length > 10000)
        throw new AppError(
          413,
          'range_required',
          '기록이 많아 전체 조회를 중단했습니다. 관리자에게 기간별 저장 조회 구성을 요청하세요.',
        );
      return { entries, version: meta?.version ?? 0 };
    });
  }
  async mutate(
    uid: string,
    actor: Entry['actor'],
    operation: 'create' | 'update' | 'delete' | 'restore',
    requestId: string,
    input?: unknown,
    id?: string,
    expectedVersion?: number,
  ) {
    const root = this.root(uid);
    requestSchema.parse(requestId);
    if (id) idSchema.parse(id);
    const parsed = input === undefined ? undefined : inputSchema.parse(input);
    if ((operation === 'create' || operation === 'update') && !parsed)
      throw new AppError(400, 'input_required', '기록 내용이 필요합니다.');
    if (operation !== 'create' && (!id || !Number.isInteger(expectedVersion)))
      throw new AppError(400, 'version_required', '수정할 기록 ID와 버전이 필요합니다.');
    this.validateInput(parsed, actor);
    const fingerprint = hash(
      stable({
        operation,
        input: parsed ?? null,
        id: id ?? null,
        expectedVersion: expectedVersion ?? null,
      }),
    );
    const reqPath = root + '/requests/' + hash(requestId),
      recordId = id ?? randomUUID(),
      at = this.now().toISOString();
    return this.store.transaction(async (tx) => {
      const prior = await tx.get<{
        fingerprint: string;
        purged?: boolean;
        result: { entry: Entry; version: number };
      }>(reqPath);
      if (prior) {
        if (prior.fingerprint !== fingerprint)
          throw new AppError(
            409,
            'idempotency_conflict',
            '같은 요청 ID에 다른 내용이 사용되었습니다.',
          );
        if (prior.purged) throw new AppError(410, 'purged', '영구 삭제된 요청입니다.');
        return prior.result;
      }
      const meta = await tx.get<{ version: number }>(root),
        before = await tx.get<Entry>(root + '/entries/' + recordId);
      if ((meta as { importing?: string })?.importing)
        throw new AppError(409, 'restore_in_progress', '백업 복원 중에는 수정할 수 없습니다.');
      if (actor === 'dot' && (operation === 'delete' || operation === 'restore'))
        throw new AppError(403, 'user_decision', '삭제와 복원은 홈페이지에서 직접 처리하세요.');
      if (operation !== 'create' && !before)
        throw new AppError(404, 'not_found', '기록을 찾을 수 없습니다.');
      if (before && before.version !== expectedVersion)
        throw new AppError(
          409,
          'version_conflict',
          '다른 곳에서 수정된 기록입니다. 새로고침한 뒤 다시 확인하세요.',
        );
      if (operation === 'update' && before?.deletedAt)
        throw new AppError(409, 'deleted', '삭제한 기록은 먼저 복원하세요.');
      if (operation === 'update' && parsed?.kind !== before?.kind)
        throw new AppError(400, 'kind_change', '기록 종류는 변경할 수 없습니다.');
      if (
        actor === 'dot' &&
        (parsed?.kind === 'goal' ||
          parsed?.kind === 'context' ||
          (parsed?.kind === 'action' &&
            (parsed.status !== 'proposed' ||
              (before?.kind === 'action' && before.status !== 'proposed'))))
      )
        throw new AppError(
          403,
          'user_decision',
          '목표·확인된 선호·제안 채택은 홈페이지에서 직접 변경하세요.',
        );
      const next = {
        ...(parsed ?? before!),
        id: recordId,
        createdAt: before?.createdAt ?? at,
        updatedAt: at,
        version: (before?.version ?? 0) + 1,
        dataVersion: (meta?.version ?? 0) + 1,
        deletedAt: operation === 'delete' ? at : null,
        actor,
      } as Entry;
      if (next.kind === 'analysis') {
        if (next.basedOnVersion > (meta?.version ?? 0))
          throw new AppError(400, 'future_version', '분석 근거 버전이 현재 기록보다 앞섭니다.');
        for (const evidenceId of next.evidenceIds) {
          idSchema.parse(evidenceId);
          if (!(await tx.get<Entry>(root + '/entries/' + evidenceId)))
            throw new AppError(400, 'invalid_evidence', '근거 기록을 찾을 수 없습니다.');
        }
      }
      if (next.kind === 'action' && next.analysisId !== undefined) {
        idSchema.parse(next.analysisId);
        const analysis = await tx.get<Entry>(root + '/entries/' + next.analysisId);
        if (analysis?.kind !== 'analysis')
          throw new AppError(
            400,
            'invalid_evidence',
            '연결할 분석 기록을 찾을 수 없습니다. 분석을 확인하거나 연결 없이 저장하세요.',
          );
      }
      const siblings =
        next.kind === 'weight' && next.representative && !next.deletedAt
          ? await tx.list<Entry>(root + '/entries', { field: 'date', equals: next.date })
          : [];
      const version = (meta?.version ?? 0) + 1;
      const writeChange = (b: Entry | null, a: Entry, op: string) => {
        a.dataVersion = version;
        tx.set(root + '/entries/' + a.id, a);
        const changeId = randomUUID();
        const change: Change = {
          id: changeId,
          entryId: a.id,
          at,
          actor,
          operation: op,
          before: b,
          after: a,
          version,
        };
        tx.set(root + '/changes/' + changeId, change);
      };
      for (const sibling of siblings)
        if (
          sibling.id !== next.id &&
          sibling.kind === 'weight' &&
          sibling.representative &&
          !sibling.deletedAt
        )
          writeChange(
            sibling,
            {
              ...sibling,
              representative: false,
              version: sibling.version + 1,
              updatedAt: at,
              actor,
            },
            'representative',
          );
      writeChange(before, next, operation);
      tx.set(root, { version, updatedAt: at });
      const result = { entry: next, version };
      tx.set(reqPath, { id: hash(requestId), fingerprint, result });
      return result;
    });
  }
  private validateInput(input: EntryInput | undefined, actor: string) {
    if (!input) return;
    if (input.occurredAt && today(new Date(input.occurredAt)) !== input.date)
      throw new AppError(
        400,
        'time_date',
        '기록 시각과 날짜가 한국 시간 기준으로 일치해야 합니다.',
      );
    if (input.kind === 'body') {
      if (input.age != null && !input.ageAsOf)
        throw new AppError(400, 'age_date', '만 나이 기준일을 입력하세요.');
      if (input.birthDate && input.birthDate > input.date)
        throw new AppError(400, 'birth_date', '생년월일은 적용일보다 이전이어야 합니다.');
      if (input.ageAsOf && input.ageAsOf > input.date)
        throw new AppError(400, 'age_date', '나이 기준일은 적용일보다 이후일 수 없습니다.');
    }
    if (input.kind === 'analysis' && input.from > input.to)
      throw new AppError(400, 'range', '분석 시작일과 종료일을 확인하세요.');
    if (input.kind === 'workout' && input.met != null && !input.metSource)
      throw new AppError(400, 'met_source', '운동 강도 출처나 추정 근거가 필요합니다.');
    if (
      input.kind === 'workout' &&
      input.status === 'done' &&
      isFutureOccurrence(input, this.now())
    )
      throw new AppError(400, 'future_workout', '미래 날짜나 시각의 운동은 계획으로 저장하세요.');
  }
  async history(uid: string, id?: string) {
    if (id) idSchema.parse(id);
    const root = this.root(uid);
    return this.store.transaction(async (tx) => {
      const meta = await tx.get<{ importing?: string }>(root);
      if (meta?.importing) throw new AppError(409, 'restore_in_progress', '백업 복원 중입니다.');
      return tx.list<Change>(
        root + '/changes',
        id ? { field: 'entryId', equals: id } : { limit: 10001 },
      );
    });
  }
  async export(uid: string) {
    return this.store.transaction(async (tx) => {
      const root = this.root(uid),
        meta = await tx.get<{ version: number; importing?: string }>(root),
        entries = await tx.list<Entry>(root + '/entries'),
        history = await tx.list<Change>(root + '/changes');
      if (meta?.importing)
        throw new AppError(409, 'restore_in_progress', '복원을 먼저 완료하세요.');
      if (entries.length > 10000 || history.length > 10000)
        throw new AppError(413, 'export_limit', '전체 내보내기 한도를 넘었습니다.');
      return {
        format: 'dot-health',
        schemaVersion: 1,
        exportedAt: this.now().toISOString(),
        version: meta?.version ?? 0,
        entries,
        history,
      };
    });
  }
  async restoreBackup(uid: string, raw: unknown) {
    const data = z
      .object({
        format: z.literal('dot-health'),
        schemaVersion: z.literal(1),
        version: z.number().int().nonnegative(),
        entries: z.array(z.unknown()).max(10000),
        history: z.array(z.unknown()).max(10000),
      })
      .parse(raw);
    const entrySchema = z.object({
      id: idSchema,
      version: z.number().int().positive(),
      dataVersion: z.number().int().nonnegative().max(data.version).optional(),
      createdAt: z.string().datetime(),
      updatedAt: z.string().datetime(),
      deletedAt: z.string().datetime().nullable(),
      actor: z.enum(['web', 'dot', 'demo']),
    });
    const validateEntry = (v: unknown): Entry => {
      const meta = entrySchema.parse(v);
      const { id, version, dataVersion, createdAt, updatedAt, deletedAt, actor, ...input } =
        v as Record<string, unknown>;
      return { ...inputSchema.parse(input), ...meta };
    };
    const entries = data.entries.map(validateEntry),
      ids = new Set(entries.map((e) => e.id));
    if (ids.size !== entries.length)
      throw new AppError(400, 'duplicate_id', '백업에 중복 ID가 있습니다.');
    const history = data.history.map((v) => {
      const c = z
        .object({
          id: idSchema,
          entryId: idSchema,
          at: z.string().datetime(),
          actor: z.enum(['web', 'dot', 'demo']),
          operation: z.string().max(30),
          before: z.unknown().nullable(),
          after: z.unknown().nullable(),
          version: z.number().int().positive(),
        })
        .parse(v);
      if (!ids.has(c.entryId) || c.version > data.version)
        throw new AppError(400, 'invalid_history', '이력의 기록 ID 또는 버전이 잘못되었습니다.');
      const before = c.before ? validateEntry(c.before) : null,
        after = c.after ? validateEntry(c.after) : null;
      if ((before && before.id !== c.entryId) || (after && after.id !== c.entryId))
        throw new AppError(400, 'invalid_history', '이력의 원본 ID가 일치하지 않습니다.');
      return { ...c, before, after };
    });
    if (new Set(history.map((c) => c.id)).size !== history.length)
      throw new AppError(400, 'duplicate_id', '백업에 중복 이력 ID가 있습니다.');
    const entriesById = new Map(entries.map((e) => [e.id, e]));
    for (const e of entries) {
      this.validateInput(e, 'web');
      if (
        e.kind === 'analysis' &&
        (e.basedOnVersion > data.version || e.evidenceIds.some((id) => !ids.has(id)))
      )
        throw new AppError(400, 'invalid_evidence', '분석 근거가 누락된 백업입니다.');
      if (
        e.kind === 'action' &&
        e.analysisId !== undefined &&
        entriesById.get(e.analysisId)?.kind !== 'analysis'
      )
        throw new AppError(400, 'invalid_evidence', '실천 항목의 분석이 누락되었습니다.');
    }
    const root = this.root(uid),
      fingerprint = hash(stable(data));
    const done = await this.store.transaction(async (tx) => {
      const meta = await tx.get<{ version: number; importing?: string; restored?: string }>(root),
        existing = await tx.list<Entry>(root + '/entries', { limit: 1 });
      if (meta?.restored === fingerprint) return true;
      if (meta?.importing && meta.importing !== fingerprint)
        throw new AppError(409, 'different_backup', '진행 중인 복원과 동일한 파일을 선택하세요.');
      if (!meta?.importing && (existing.length || meta?.version))
        throw new AppError(
          409,
          'not_empty',
          '백업 복원은 기록과 이력이 없는 계정에서만 가능합니다.',
        );
      tx.set(root, { version: 0, importing: fingerprint });
      return false;
    });
    if (done) return { restored: entries.length, alreadyRestored: true };
    const writes = [
      ...entries.map((e) => ({ path: root + '/entries/' + e.id, value: e })),
      ...history.map((c) => ({ path: root + '/changes/' + c.id, value: c })),
    ];
    for (let i = 0; i < writes.length; i += 200)
      await this.store.transaction(async (tx) => {
        const meta = await tx.get<{ importing?: string }>(root);
        if (meta?.importing !== fingerprint)
          throw new AppError(409, 'restore_lock', '복원 잠금이 변경되었습니다.');
        for (const w of writes.slice(i, i + 200)) tx.set(w.path, w.value);
      });
    await this.store.transaction(async (tx) => {
      const meta = await tx.get<{ importing?: string }>(root);
      if (meta?.importing !== fingerprint)
        throw new AppError(409, 'restore_lock', '복원 잠금이 변경되었습니다.');
      tx.set(root, {
        version: data.version,
        restored: fingerprint,
        updatedAt: this.now().toISOString(),
      });
    });
    return { restored: entries.length };
  }
  async purge(uid: string, id: string, version: number, confirmation: string) {
    idSchema.parse(id);
    if (confirmation !== '영구 삭제')
      throw new AppError(400, 'confirmation', '영구 삭제 확인 문구가 필요합니다.');
    const root = this.root(uid);
    return this.store.transaction(async (tx) => {
      const entry = await tx.get<Entry>(root + '/entries/' + id),
        meta = await tx.get<{ version: number }>(root);
      if (!entry || !entry.deletedAt || entry.version !== version)
        throw new AppError(409, 'purge_conflict', '휴지통에서 최신 기록을 확인한 뒤 삭제하세요.');
      if ((meta as { importing?: string })?.importing)
        throw new AppError(409, 'restore_in_progress', '복원을 먼저 완료하세요.');
      const entries = await tx.list<Entry>(root + '/entries'),
        allChanges = await tx.list<Change>(root + '/changes');
      const requests = await tx.list<{
        id: string;
        fingerprint: string;
        result?: { entry: Entry };
      }>(root + '/requests');
      const removed = new Set([id]);
      let count = 0;
      while (count !== removed.size) {
        count = removed.size;
        for (const e of entries)
          if (
            (e.kind === 'analysis' && e.evidenceIds.some((x) => removed.has(x))) ||
            (e.kind === 'action' && e.analysisId && removed.has(e.analysisId))
          )
            removed.add(e.id);
      }
      const changes = allChanges.filter((c) => removed.has(c.entryId)),
        redact = requests.filter((r) => r.result && removed.has(r.result.entry.id));
      if (
        entries.length > 10000 ||
        allChanges.length > 10000 ||
        requests.length > 10000 ||
        changes.length + removed.size + redact.length > 450
      )
        throw new AppError(413, 'purge_limit', '삭제 범위가 커서 일괄 처리를 중단했습니다.');
      for (const entryId of removed) tx.remove(root + '/entries/' + entryId);
      for (const c of changes) tx.remove(root + '/changes/' + c.id);
      for (const r of redact)
        tx.set(root + '/requests/' + r.id, { id: r.id, fingerprint: r.fingerprint, purged: true });
      tx.set(root, { version: (meta?.version ?? 0) + 1, updatedAt: this.now().toISOString() });
      return { removed: true, removedRecords: removed.size, version: (meta?.version ?? 0) + 1 };
    });
  }
}
