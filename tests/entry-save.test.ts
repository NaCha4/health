import { describe, it, expect } from 'vitest';
import { EntrySaver, ApiError } from '../src/entry-save.js';
import { AppError, HealthService } from '../functions/src/health.js';
import { MemoryStore } from '../functions/src/store.js';
import { inputSchema, type Entry, type EntryInput } from '../shared/schema.js';
import { mealEnergy } from '../shared/energy.js';

const uid = 'synthetic-save-fixture';
const meal = (quantity = 1) =>
  inputSchema.parse({
    kind: 'meal',
    date: '2026-10-08',
    name: 'Synthetic retry meal',
    mealType: 'lunch',
    items: [
      {
        name: 'Synthetic food',
        quantity,
        basisAmount: 1,
        unit: 'serving',
        kcal: 450,
        source: { kind: 'user', title: 'Fixture only' },
      },
    ],
  });
function fixture(fail: (call: number, phase: 'before' | 'after') => void = () => {}) {
  const health = new HealthService(new MemoryStore());
  const calls: Array<{ input: EntryInput; entry?: Entry; requestId: string }> = [];
  const write = async (input: EntryInput, entry: Entry | undefined, requestId: string) => {
    const call = calls.push(structuredClone({ input, entry, requestId }));
    fail(call, 'before');
    try {
      const result = await health.mutate(
        uid,
        'web',
        entry ? 'update' : 'create',
        requestId,
        input,
        entry?.id,
        entry?.version,
      );
      fail(call, 'after');
      return result;
    } catch (e) {
      if (e instanceof AppError) throw new ApiError(e.message, e.status, e.code);
      throw e;
    }
  };
  return { health, calls, saver: new EntrySaver(write) };
}
const lost = () => {
  throw new TypeError('Synthetic lost response');
};

describe('응답 손실 후 한 논리 기록의 저장', () => {
  it('저장 후 응답 손실과 분량 수정 재시도에도 한 끼 225 kcal만 남는다', async () => {
    const { health, saver, calls } = fixture((call, phase) => {
      if (call === 1 && phase === 'after') lost();
    });
    await expect(saver.save(meal())).rejects.toThrow('Synthetic lost response');
    await saver.save(meal(0.5));
    const snapshot = await health.snapshot(uid);
    expect(snapshot.entries).toHaveLength(1);
    const entry = snapshot.entries[0];
    expect(entry.kind === 'meal' && mealEnergy(entry.items).value).toBe(225);
    expect(entry.version).toBe(2);
    expect(calls[1].requestId).toBe(calls[0].requestId);
    expect(calls[1].input).toEqual(calls[0].input);
    expect(calls[2].entry?.id).toBe(entry.id);
    expect(calls[2].entry?.version).toBe(1);
    expect(calls[2].requestId).not.toBe(calls[0].requestId);
  });
  it('바꾸지 않은 재시도는 새 이력이나 수정 요청을 만들지 않는다', async () => {
    const { health, saver, calls } = fixture((call, phase) => {
      if (call === 1 && phase === 'after') lost();
    });
    await expect(saver.save(meal())).rejects.toThrow();
    await saver.save(meal());
    expect(calls).toHaveLength(2);
    expect(await health.history(uid)).toHaveLength(1);
    expect((await health.snapshot(uid)).entries).toHaveLength(1);
  });
  it('서버 도착 전 실패도 원래 요청을 확인한 다음 같은 기록을 정정한다', async () => {
    const { health, saver } = fixture((call, phase) => {
      if (call === 1 && phase === 'before') lost();
    });
    await expect(saver.save(meal())).rejects.toThrow();
    expect((await health.snapshot(uid)).entries).toHaveLength(0);
    await saver.save(meal(0.5));
    const s = await health.snapshot(uid);
    expect(s.entries).toHaveLength(1);
    expect(s.entries[0]).toMatchObject({ version: 2, items: [{ quantity: 0.5 }] });
  });
  it('확정된 400 오류 뒤에는 잘못된 이전 입력을 계속 재시도하지 않는다', async () => {
    const { health, saver, calls } = fixture((call, phase) => {
      if (call === 1 && phase === 'before')
        throw new ApiError('Synthetic rejected input', 400, 'validation');
    });
    await expect(saver.save(meal())).rejects.toMatchObject({ status: 400 });
    expect(saver.hasPending).toBe(false);
    await saver.save(meal(0.5));
    expect(calls).toHaveLength(2);
    expect(calls[1].requestId).not.toBe(calls[0].requestId);
    expect((await health.snapshot(uid)).entries[0]).toMatchObject({
      version: 1,
      items: [{ quantity: 0.5 }],
    });
  });
  it('다른 경로의 최신 수정은 응답 손실 복구 후에도 덮어쓰지 않는다', async () => {
    const { health, saver } = fixture((call, phase) => {
      if (call === 1 && phase === 'after') lost();
    });
    await expect(saver.save(meal())).rejects.toThrow();
    const row = (await health.snapshot(uid)).entries[0];
    await health.mutate(uid, 'dot', 'update', 'other-writer-update', meal(0.25), row.id, 1);
    await expect(saver.save(meal(0.5))).rejects.toMatchObject({
      status: 409,
      code: 'version_conflict',
    });
    const s = await health.snapshot(uid);
    expect(s.entries).toHaveLength(1);
    expect(s.entries[0]).toMatchObject({ version: 2, items: [{ quantity: 0.25 }] });
  });
  it('호출자가 초안 객체를 바꿔도 미확정 요청의 원본은 유지한다', async () => {
    const { health, saver, calls } = fixture((call, phase) => {
      if (call === 1 && phase === 'after') lost();
    });
    const draft = meal();
    await expect(saver.save(draft)).rejects.toThrow();
    if (draft.kind === 'meal') draft.items[0].quantity = 0.5;
    await saver.save(draft);
    expect(calls[1].input).toEqual(meal());
    expect((await health.snapshot(uid)).entries).toHaveLength(1);
  });
  for (const status of [408, 500])
    it(`${status} 응답도 저장 여부가 불확실하므로 원래 요청으로 복구한다`, async () => {
      const { health, saver, calls } = fixture((call, phase) => {
        if (call === 1 && phase === 'after')
          throw new ApiError('Synthetic uncertain response', status);
      });
      await expect(saver.save(meal())).rejects.toMatchObject({ status });
      await saver.save(meal(0.5));
      expect(calls[1].requestId).toBe(calls[0].requestId);
      expect((await health.snapshot(uid)).entries).toHaveLength(1);
    });
  it('정정 요청의 응답도 손실되면 정정 요청을 재생하고 최신 분량을 적용한다', async () => {
    const { health, saver, calls } = fixture((call, phase) => {
      if ([1, 3].includes(call) && phase === 'after') lost();
    });
    await expect(saver.save(meal())).rejects.toThrow();
    await expect(saver.save(meal(0.5))).rejects.toThrow();
    await saver.save(meal(0.25));
    const s = await health.snapshot(uid);
    expect(s.entries).toHaveLength(1);
    expect(s.entries[0]).toMatchObject({ version: 3, items: [{ quantity: 0.25 }] });
    expect(calls[3].requestId).toBe(calls[2].requestId);
  });
  it('연속 제출도 하나의 진행 중 요청만 만든다', async () => {
    const { health, saver, calls } = fixture();
    const [a, b] = await Promise.all([saver.save(meal()), saver.save(meal())]);
    expect(a).toEqual(b);
    expect(calls).toHaveLength(1);
    expect((await health.snapshot(uid)).entries).toHaveLength(1);
  });
});
