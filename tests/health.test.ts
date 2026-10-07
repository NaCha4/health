import { describe, it, expect } from 'vitest';
import { HealthService } from '../functions/src/health.js';
import { MemoryStore } from '../functions/src/store.js';
const date = '2026-10-07',
  weight = { kind: 'weight', date, kg: 80, representative: true },
  uid = 'fixture-owner';
const fixture = () => new HealthService(new MemoryStore(), () => new Date('2026-10-08T04:00:00Z'));
describe('기록 저장과 복구', () => {
  it('동시 동일 요청을 한 번만 저장하고 다른 내용은 충돌한다', async () => {
    const h = fixture();
    const [a, b] = await Promise.all([
      h.mutate(uid, 'web', 'create', 'same-request', weight),
      h.mutate(uid, 'web', 'create', 'same-request', weight),
    ]);
    expect(a.entry.id === b.entry.id).toBe(true);
    expect((await h.snapshot(uid)).entries).toHaveLength(1);
    await expect(
      h.mutate(uid, 'web', 'create', 'same-request', { ...weight, kg: 81 }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('오래된 버전으로 새 수정값을 덮어쓰지 않는다', async () => {
    const h = fixture(),
      a = await h.mutate(uid, 'web', 'create', 'create-request', weight);
    const values = await Promise.allSettled([
      h.mutate(uid, 'web', 'update', 'first-update', { ...weight, kg: 81 }, a.entry.id, 1),
      h.mutate(uid, 'dot', 'update', 'other-update', { ...weight, kg: 82 }, a.entry.id, 1),
    ]);
    expect(values.filter((v) => v.status === 'fulfilled')).toHaveLength(1);
    expect(values.filter((v) => v.status === 'rejected')).toHaveLength(1);
    expect(await h.history(uid)).toHaveLength(2);
  });
  it('한 날짜의 대표 측정은 하나이고 변경 이력도 남는다', async () => {
    const h = fixture();
    await h.mutate(uid, 'web', 'create', 'first-weight', weight);
    await h.mutate(uid, 'web', 'create', 'other-weight', { ...weight, kg: 82 });
    const s = await h.snapshot(uid);
    expect(s.entries.filter((e) => e.kind === 'weight' && e.representative)).toHaveLength(1);
    expect(await h.history(uid)).toHaveLength(3);
  });
  it('다른 UID는 같은 ID를 읽거나 수정하지 못한다', async () => {
    const h = fixture(),
      a = await h.mutate(uid, 'web', 'create', 'create-request', weight);
    expect((await h.snapshot('other')).entries).toHaveLength(0);
    await expect(
      h.mutate('other', 'web', 'update', 'other-update', weight, a.entry.id, 1),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('삭제는 복원할 수 있고 dot의 삭제·목표 변경은 거절한다', async () => {
    const h = fixture(),
      a = await h.mutate(uid, 'web', 'create', 'create-request', weight);
    await expect(
      h.mutate(uid, 'dot', 'delete', 'delete-request', undefined, a.entry.id, 1),
    ).rejects.toMatchObject({ status: 403 });
    const b = await h.mutate(uid, 'web', 'delete', 'delete-web-request', undefined, a.entry.id, 1);
    expect(b.entry.deletedAt !== null).toBe(true);
    const c = await h.mutate(uid, 'web', 'restore', 'restore-request', undefined, a.entry.id, 2);
    expect(c.entry.deletedAt).toBeNull();
    await expect(
      h.mutate(uid, 'dot', 'create', 'create-goal', { kind: 'goal', date, title: 'fixture goal' }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('영구 삭제시 원본, 이력, 연결 분석 및 요청 응답을 지운다', async () => {
    const h = fixture(),
      a = await h.mutate(uid, 'web', 'create', 'create-request', weight);
    await h.mutate(uid, 'dot', 'create', 'create-analysis', {
      kind: 'analysis',
      date,
      title: 'fixture',
      from: date,
      to: date,
      observations: '80',
      limitations: 'fixture',
      suggestions: 'fixture',
      basedOnVersion: 1,
      evidenceIds: [a.entry.id],
    });
    await h.mutate(uid, 'web', 'delete', 'delete-request', undefined, a.entry.id, 1);
    await expect(h.purge(uid, a.entry.id, 2, '잘못된 확인')).rejects.toMatchObject({ status: 400 });
    await h.purge(uid, a.entry.id, 2, '영구 삭제');
    expect((await h.snapshot(uid)).entries).toHaveLength(0);
    expect(await h.history(uid)).toHaveLength(0);
    await expect(h.mutate(uid, 'web', 'create', 'create-request', weight)).rejects.toMatchObject({
      status: 410,
    });
  });
  it('백업을 빈 계정으로 복원하며 ID·출처·이력·버전을 보존한다', async () => {
    const h = fixture();
    await h.mutate(uid, 'web', 'create', 'create-request', weight);
    const data = await h.export(uid);
    await h.restoreBackup('restored-owner', data);
    expect(await h.snapshot('restored-owner')).toEqual(await h.snapshot(uid));
    expect(await h.history('restored-owner')).toEqual(await h.history(uid));
    expect(await h.restoreBackup('restored-owner', data)).toMatchObject({ alreadyRestored: true });
    await expect(h.restoreBackup(uid, data)).rejects.toMatchObject({ code: 'not_empty' });
  });
  it('누락된 근거와 변조한 백업을 저장 전에 거절한다', async () => {
    const h = fixture();
    await expect(
      h.mutate(uid, 'dot', 'create', 'create-analysis', {
        kind: 'analysis',
        date,
        title: 'fixture',
        from: date,
        to: date,
        observations: '',
        limitations: '',
        suggestions: '',
        basedOnVersion: 0,
        evidenceIds: ['not-there'],
      }),
    ).rejects.toMatchObject({ code: 'invalid_evidence' });
    await h.mutate(uid, 'web', 'create', 'create-request', weight);
    const data = await h.export(uid);
    data.entries.push(data.entries[0]);
    await expect(h.restoreBackup('other', data)).rejects.toMatchObject({ code: 'duplicate_id' });
    expect((await h.snapshot('other')).entries).toHaveLength(0);
  });
  it('출처 없는 MET와 미래 완료 운동을 거절한다', async () => {
    const h = fixture();
    await expect(
      h.mutate(uid, 'web', 'create', 'workout-no-source', {
        kind: 'workout',
        date,
        name: 'fixture',
        met: 4,
      }),
    ).rejects.toMatchObject({ code: 'met_source' });
    await expect(
      h.mutate(uid, 'web', 'create', 'workout-future', {
        kind: 'workout',
        date: '2027-01-01',
        name: 'fixture',
      }),
    ).rejects.toMatchObject({ code: 'future_workout' });
  });
});
