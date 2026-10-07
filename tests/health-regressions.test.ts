import { describe, it, expect } from 'vitest';
import { HealthService } from '../functions/src/health.js';
import { MemoryStore } from '../functions/src/store.js';
import { calculateDay } from '../shared/energy.js';
import { inputSchema, type Entry } from '../shared/schema.js';

const date = '2026-10-08',
  now = new Date('2026-10-08T04:00:00Z'),
  uid = 'regression-fixture';
const fixture = () => new HealthService(new MemoryStore(), () => now);
const analysis = {
  kind: 'analysis',
  date,
  title: 'Synthetic analysis',
  from: date,
  to: date,
  observations: 'Synthetic only',
  limitations: 'Synthetic only',
  suggestions: 'Synthetic only',
  evidenceIds: [],
  basedOnVersion: 0,
};
const action = { kind: 'action', date, title: 'Synthetic action', status: 'proposed' };
const workout = {
  kind: 'workout',
  date,
  name: 'Synthetic workout',
  minutes: 60,
  status: 'done',
  occurredAt: '2026-10-08T14:00:00Z',
  met: 5,
  referenceMet: 1,
  includedInBaseline: false,
  metSource: { kind: 'user', title: 'Synthetic fixture' },
};

describe('실천 항목의 분석 참조와 사용자 결정 보호', () => {
  it('없는 분석 ID는 저장 전에 거절하고 버전·이력을 남기지 않는다', async () => {
    const h = fixture();
    await expect(
      h.mutate(uid, 'dot', 'create', 'missing-analysis-ref', { ...action, analysisId: 'missing' }),
    ).rejects.toMatchObject({ code: 'invalid_evidence' });
    expect(await h.snapshot(uid)).toEqual({ version: 0, entries: [] });
    expect(await h.history(uid)).toEqual([]);
  });
  it('체중 기록이나 다른 계정의 분석은 연결하지 못한다', async () => {
    const h = fixture();
    const w = await h.mutate(uid, 'web', 'create', 'reference-weight', {
      kind: 'weight',
      date,
      kg: 80,
    });
    const a = await h.mutate('other-fixture', 'web', 'create', 'reference-analysis', analysis);
    for (const id of [w.entry.id, a.entry.id])
      await expect(
        h.mutate(uid, 'dot', 'create', 'invalid-ref-' + id, { ...action, analysisId: id }),
      ).rejects.toMatchObject({ code: 'invalid_evidence' });
    expect((await h.snapshot(uid)).version).toBe(1);
  });
  it('실천 항목을 잘못된 분석으로 수정해도 기존 연결이 보존된다', async () => {
    const h = fixture(),
      a = await h.mutate(uid, 'web', 'create', 'valid-analysis-first', analysis);
    const original = { ...action, analysisId: a.entry.id };
    const row = await h.mutate(uid, 'dot', 'create', 'valid-action-first', original);
    await expect(
      h.mutate(
        uid,
        'dot',
        'update',
        'invalid-action-update',
        { ...original, analysisId: 'missing' },
        row.entry.id,
        1,
      ),
    ).rejects.toMatchObject({ code: 'invalid_evidence' });
    expect((await h.snapshot(uid)).entries.find((e) => e.id === row.entry.id)).toEqual(row.entry);
  });
  it('유효 연결·연결 없는 제안과 휴지통 분석 참조를 자체 백업으로 복원한다', async () => {
    const h = fixture(),
      a = await h.mutate(uid, 'web', 'create', 'roundtrip-analysis', analysis);
    await h.mutate(uid, 'dot', 'create', 'roundtrip-action', { ...action, analysisId: a.entry.id });
    await h.mutate(uid, 'dot', 'create', 'roundtrip-unlinked', action);
    await h.mutate(uid, 'web', 'delete', 'roundtrip-analysis-trash', undefined, a.entry.id, 1);
    const backup = await h.export(uid);
    await h.restoreBackup('restored-fixture', backup);
    expect(await h.snapshot('restored-fixture')).toEqual(await h.snapshot(uid));
    expect(await h.history('restored-fixture')).toEqual(await h.history(uid));
  });
  it('백업의 존재하지만 분석이 아닌 참조도 복원 전에 거절한다', async () => {
    const h = fixture();
    const w = await h.mutate(uid, 'web', 'create', 'backup-weight-ref', {
      kind: 'weight',
      date,
      kg: 80,
    });
    await h.mutate(uid, 'dot', 'create', 'backup-unlinked-action', action);
    const backup = await h.export(uid);
    backup.entries = backup.entries.map((e) =>
      e.kind === 'action' ? { ...e, analysisId: w.entry.id } : e,
    );
    await expect(h.restoreBackup('invalid-backup-fixture', backup)).rejects.toMatchObject({
      code: 'invalid_evidence',
    });
    expect((await h.snapshot('invalid-backup-fixture')).entries).toEqual([]);
  });
  for (const status of ['accepted', 'deferred', 'done'])
    it(`dot는 사용자가 ${status}로 정한 항목을 proposed로 되돌리지 못한다`, async () => {
      const h = fixture(),
        row = await h.mutate(uid, 'web', 'create', 'user-decision-' + status, {
          ...action,
          status,
        });
      await expect(
        h.mutate(uid, 'dot', 'update', 'dot-reset-' + status, action, row.entry.id, 1),
      ).rejects.toMatchObject({ code: 'user_decision' });
      expect((await h.snapshot(uid)).entries[0]).toEqual(row.entry);
    });
  it('dot의 미채택 제안 수정과 사용자의 상태 변경은 계속 허용한다', async () => {
    const h = fixture(),
      row = await h.mutate(uid, 'dot', 'create', 'new-dot-proposal', action);
    await h.mutate(
      uid,
      'dot',
      'update',
      'edit-dot-proposal',
      { ...action, title: 'Clarified synthetic action' },
      row.entry.id,
      1,
    );
    await h.mutate(
      uid,
      'web',
      'update',
      'user-accepts-proposal',
      { ...action, status: 'accepted' },
      row.entry.id,
      2,
    );
    await h.mutate(uid, 'dot', 'create', 'new-dot-proposal', action);
    expect((await h.snapshot(uid)).entries[0]).toMatchObject({ status: 'accepted', version: 3 });
  });
});

describe('실제 시각 기준 미래 운동 보호', () => {
  it('오늘의 미래 시각에 해당하는 완료 운동을 저장하지 않는다', async () => {
    const h = fixture();
    await expect(h.mutate(uid, 'dot', 'create', 'future-same-day', workout)).rejects.toMatchObject({
      code: 'future_workout',
    });
    expect((await h.snapshot(uid)).entries).toEqual([]);
  });
  it('현재 시각과 이전 시각의 완료, 미래 시각의 계획은 허용한다', async () => {
    const h = fixture();
    for (const [index, patch] of [
      { occurredAt: now.toISOString() },
      { occurredAt: '2026-10-08T03:59:59Z' },
      { status: 'planned' },
    ].entries())
      await h.mutate(uid, 'web', 'create', 'valid-workout-' + index, { ...workout, ...patch });
    expect(calculateDay(await h.snapshot(uid), date, now).workoutMinutes).toBe(120);
  });
  it('이미 저장된 미래 시각 완료 기록도 운동량·열량·근거에서 제외한다', () => {
    const make = (input: unknown, id: string): Entry => ({
      ...inputSchema.parse(input),
      id,
      version: 1,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      actor: 'web',
      deletedAt: null,
    });
    const snapshot = {
      version: 2,
      entries: [make({ kind: 'weight', date, kg: 80 }, 'weight'), make(workout, 'legacy-future')],
    };
    const before = calculateDay(snapshot, date, now);
    expect(before.workoutMinutes).toBe(0);
    expect(before.workouts).toEqual([]);
    expect(before.additionalExercise).toBe(0);
    expect(before.evidenceIds).not.toContain('legacy-future');
    const after = calculateDay(snapshot, date, new Date(workout.occurredAt));
    expect(after.workoutMinutes).toBe(60);
    expect(after.workouts[0]).toMatchObject({ gross: 400, net: 320, extra: 320 });
  });
});
