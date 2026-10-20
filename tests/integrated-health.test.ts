import { describe, it, expect } from 'vitest';
import { HealthService } from '../functions/src/health.js';
import { MemoryStore } from '../functions/src/store.js';
import {
  compareHealth,
  healthPeriod,
  medicationPlans,
  sleepForDay,
  timeline,
  timelineCsv,
} from '../shared/integrated.js';
import { inputSchema, type Entry, type EntryInput } from '../shared/schema.js';

const date = '2026-10-08',
  now = new Date('2026-10-20T04:00:00Z');
const fixture = () => new HealthService(new MemoryStore(), () => now);
const medication = {
  kind: 'medication',
  date,
  name: 'SYNTHETIC fixture A',
  dose: 'SYNTHETIC 1 unit',
  doseConfirmed: true,
  route: 'injection',
  schedule: 'SYNTHETIC schedule',
  status: 'active',
};
const dose = (medicationId: string, extra = {}) => ({
  kind: 'dose',
  date,
  medicationId,
  occurredAt: date + 'T09:00:00+09:00',
  status: 'taken',
  actualDose: 'SYNTHETIC 1 unit',
  ...extra,
});
const row = (id: string, input: unknown): Entry => ({
  ...inputSchema.parse(input),
  id,
  version: 1,
  createdAt: date + 'T00:00:00Z',
  updatedAt: date + 'T00:00:00Z',
  deletedAt: null,
  actor: 'demo',
});

describe('통합 건강 모델과 관찰 요약', () => {
  it('기존 입력과 빈 계정을 유지하며 미기록을 0으로 채우지 않는다', () => {
    expect(inputSchema.parse({ kind: 'checkin', date }).kind).toBe('checkin');
    const c = compareHealth({ entries: [], version: 0 }, date, date);
    expect(c.current).toMatchObject({
      sleepAverage: null,
      weightAverage: null,
      weightDays: 0,
      sleepDays: 0,
      taken: 0,
      symptomDays: 0,
      patternEvidence: [],
    });
    expect(c.sleepDelta).toBeNull();
    expect(c.weightDelta).toBeNull();
    expect(inputSchema.safeParse({ ...medication, doseConfirmed: false }).success).toBe(false);
    expect(
      inputSchema.safeParse({ kind: 'symptom', date, name: 'SYNTHETIC', severity: 10.5 }).success,
    ).toBe(false);
  });
  it('수면은 하루별 한 건만 집계하고 기존 하루 점검을 보존한다', () => {
    const check = row('old', { kind: 'checkin', date, sleepHours: 8 }),
      sleep = row('new', { kind: 'sleep', date, hours: 6 });
    const entries = [
      check,
      sleep,
      row('duplicate', { kind: 'sleep', date, hours: 6 }),
      row('prior', { kind: 'sleep', date: '2026-10-07', hours: 4 }),
    ];
    expect(sleepForDay(entries, date)?.hours).toBe(6);
    expect(healthPeriod({ entries, version: 4 }, '2026-10-06', date)).toMatchObject({
      sleepAverage: 5,
      sleepDays: 2,
    });
    expect(sleepForDay([check, { ...sleep, deletedAt: now.toISOString() }], date)?.hours).toBe(8);
    expect(compareHealth({ entries, version: 4 }, date, date).sleepDelta).toBe(2);
  });
  it('실제 투여와 처방을 구분하고 0점·삭제·기간 밖 증상을 패턴으로 세지 않는다', () => {
    const entries = [
      row('plan', medication),
      row('taken', dose('plan')),
      row('skipped', dose('plan', { status: 'skipped', actualDose: null })),
      row('symptom', { kind: 'symptom', date, name: 'SYNTHETIC signal', severity: 4 }),
      row('no-symptom', {
        kind: 'symptom',
        date: '2026-10-09',
        name: 'SYNTHETIC signal',
        severity: 0,
      }),
      {
        ...row('deleted', { kind: 'symptom', date, name: 'SYNTHETIC', severity: 5 }),
        deletedAt: now.toISOString(),
      },
    ];
    const c = healthPeriod({ entries, version: 6 }, date, '2026-10-09');
    expect(c).toMatchObject({
      taken: 1,
      skipped: 1,
      symptomCount: 2,
      symptomDays: 1,
      overlapDays: 1,
    });
    expect(c.patternEvidence.sort()).toEqual(['symptom', 'taken']);
    expect(healthPeriod({ entries, version: 6 }, '2026-10-09', '2026-10-09').overlapDays).toBe(0);
  });
  it('변경 적용일 이전 일정과 중단 이후 상태를 구분한다', () => {
    const first = row('first', medication),
      second = row('second', {
        ...medication,
        date: '2026-10-10',
        previousId: 'first',
        status: 'stopped',
      });
    expect(medicationPlans([first, second], date).map((e) => e.id)).toEqual(['first']);
    expect(medicationPlans([first, second], '2026-10-10')).toEqual([second]);
  });
  it('시각은 실제 순간으로 정렬하고 CSV는 모든 상세 필드와 수식 방지를 포함한다', () => {
    const entries = [
      row('utc', {
        kind: 'symptom',
        date,
        name: '=SYNTHETIC',
        severity: 3,
        occurredAt: '2026-10-08T01:00:00Z',
      }),
      row('korea', { kind: 'sleep', date, hours: 7, occurredAt: '2026-10-08T09:30:00+09:00' }),
    ];
    expect(timeline(entries, date, date).map((e) => e.id)).toEqual(['utc', 'korea']);
    const csv = timelineCsv(entries, date, date);
    expect(csv).toContain("'=SYNTHETIC");
    expect(csv).toContain('severity');
    expect(csv).toContain('10:00:00');
  });
});
describe('처방 이력·실제 투여의 서버 무결성', () => {
  it('확정 용량·시각·계정 참조를 검증하고 부적합 입력을 쓰지 않는다', async () => {
    const h = fixture(),
      p = await h.mutate('fixture', 'web', 'create', 'synthetic-plan', medication);
    for (const input of [
      dose('missing'),
      dose(p.entry.id, { date: '2026-10-07', occurredAt: '2026-10-07T09:00:00+09:00' }),
      dose(p.entry.id, { date: '2026-10-21', occurredAt: '2026-10-21T09:00:00+09:00' }),
      dose(p.entry.id, { occurredAt: '2026-10-08T23:00:00Z' }),
      dose(p.entry.id, { actualDose: null }),
      dose(p.entry.id, { status: 'skipped' }),
    ])
      await expect(
        h.mutate('fixture', 'web', 'create', 'synthetic-bad-' + crypto.randomUUID(), input),
      ).rejects.toBeTruthy();
    await expect(
      h.mutate('other', 'web', 'create', 'cross-user-ref', dose(p.entry.id)),
    ).rejects.toMatchObject({ code: 'medication_reference' });
    expect((await h.snapshot('fixture')).version).toBe(1);
    expect(await h.snapshot('other')).toEqual({ entries: [], version: 0 });
  });
  it('재시도는 하나만 저장하고 처방 변경·중단과 이전 실제량을 함께 보존한다', async () => {
    const h = fixture(),
      p = await h.mutate('fixture', 'web', 'create', 'synthetic-plan', medication);
    const d = await h.mutate('fixture', 'dot', 'create', 'synthetic-dose', dose(p.entry.id));
    expect(await h.mutate('fixture', 'dot', 'create', 'synthetic-dose', dose(p.entry.id))).toEqual(
      d,
    );
    const stopped = await h.mutate('fixture', 'web', 'create', 'synthetic-stop', {
      ...medication,
      date: '2026-10-09',
      previousId: p.entry.id,
      status: 'stopped',
      changeReason: 'SYNTHETIC change',
    });
    expect((await h.snapshot('fixture')).entries).toHaveLength(3);
    expect(medicationPlans((await h.snapshot('fixture')).entries, '2026-10-10')[0].id).toBe(
      stopped.entry.id,
    );
    await expect(
      h.mutate('fixture', 'web', 'update', 'overwrite-plan', medication, p.entry.id, 1),
    ).rejects.toMatchObject({ code: 'medication_history' });
    await expect(
      h.mutate('fixture', 'web', 'delete', 'delete-plan', undefined, p.entry.id, 1),
    ).rejects.toMatchObject({ code: 'medication_history' });
    await expect(
      h.mutate('fixture', 'dot', 'create', 'automatic-plan-change', medication),
    ).rejects.toMatchObject({ code: 'user_decision' });
    await expect(
      h.mutate('fixture', 'web', 'create', 'duplicate-plan-change', {
        ...medication,
        previousId: p.entry.id,
      }),
    ).rejects.toMatchObject({ code: 'medication_conflict' });
    expect((await h.history('fixture')).length).toBe(3);
  });
  it('새로운 종류와 변경 이력을 기존 JSON 형식으로 왕복하며 운영 기록을 덮어쓰지 않는다', async () => {
    const h = fixture(),
      p = await h.mutate('fixture', 'web', 'create', 'synthetic-plan', medication);
    await h.mutate('fixture', 'web', 'create', 'synthetic-dose', dose(p.entry.id));
    await h.mutate('fixture', 'web', 'create', 'synthetic-sleep', {
      kind: 'sleep',
      date,
      hours: 7,
    });
    await h.mutate('fixture', 'web', 'create', 'synthetic-symptom', {
      kind: 'symptom',
      date,
      name: 'SYNTHETIC signal',
      severity: 3,
    });
    const backup = await h.export('fixture');
    await h.restoreBackup('restored', backup);
    expect(await h.snapshot('restored')).toEqual(await h.snapshot('fixture'));
    expect(await h.history('restored')).toEqual(await h.history('fixture'));
    await expect(h.restoreBackup('fixture', backup)).rejects.toMatchObject({ code: 'not_empty' });
    const bad = structuredClone(backup);
    bad.entries = bad.entries.filter((e) => e.kind !== 'medication');
    bad.history = [];
    await expect(h.restoreBackup('invalid', bad)).rejects.toMatchObject({
      code: 'medication_reference',
    });
    expect(await h.snapshot('invalid')).toEqual({ entries: [], version: 0 });
  });
});
