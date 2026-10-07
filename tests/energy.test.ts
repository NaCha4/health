import { describe, it, expect } from 'vitest';
import {
  inputSchema,
  foodItemSchema,
  dateSchema,
  type Entry,
  type EntryInput,
  type Snapshot,
} from '../shared/schema.js';
import { calculateDay, foodEnergy, mealEnergy, summarize } from '../shared/energy.js';
import { today, datesInRange, ageAt } from '../shared/dates.js';
import { demoSnapshot } from '../shared/demo.js';
const now = new Date('2026-10-08T04:00:00Z'),
  date = '2026-10-07';
let id = 0;
const e = (v: any): Entry => ({
  ...inputSchema.parse({ date, note: '', ...v }),
  id: 'test-' + ++id,
  version: 1,
  createdAt: date + 'T01:00:00Z',
  updatedAt: date + 'T01:00:00Z',
  deletedAt: null,
  actor: 'web',
});
const source = { kind: 'user' as const, title: 'Fixture only' };
const food = () => ({
  name: 'Fixture food',
  quantity: 150,
  unit: 'g' as const,
  basisAmount: 100,
  kcal: 200,
  source,
});
const fixture = (): Snapshot => ({
  version: 5,
  entries: [
    e({ kind: 'weight', kg: 80 }),
    e({
      kind: 'body',
      heightCm: 180,
      birthDate: '1986-01-01',
      coefficient: 'male',
      eligibility: 'adult',
    }),
    e({
      kind: 'baseline',
      factor: 1.2,
      mode: 'excludes_exercise',
      description: 'Fixture only',
      source,
    }),
    e({ kind: 'checkin', mealsComplete: true, activityComplete: true }),
  ],
});
describe('원본 기반 에너지 계산', () => {
  it('기획안의 산술 검증 수치를 그대로 재현한다', () => {
    const s = fixture();
    s.entries = s.entries.map((x) =>
      x.kind === 'body'
        ? { ...x, heightCm: 175, birthDate: '1996-01-01' }
        : x.kind === 'baseline'
          ? { ...x, factor: 1.4 }
          : x,
    );
    s.entries.push(
      e({
        kind: 'workout',
        name: 'Fixture',
        minutes: 30,
        met: 5,
        referenceMet: 1,
        metSource: source,
        includedInBaseline: false,
      }),
    );
    const d = calculateDay(s, date, now);
    expect(d.ree).toBe(1748.75);
    expect(d.workouts[0]).toMatchObject({ gross: 200, net: 160, extra: 160 });
    expect(d.totalExpenditure).toBe(2608.25);
    expect(foodEnergy({ ...food(), quantity: 180, kcal: 250 }).value).toBe(450);
    expect(foodEnergy({ ...food(), quantity: 90, kcal: 250 }).value).toBe(225);
  });
  it('공식과 기준선 대비 운동 증가분을 계산한다', () => {
    const s = fixture();
    s.entries.push(
      e({
        kind: 'workout',
        name: 'Fixture',
        minutes: 30,
        met: 4,
        referenceMet: 1.2,
        metSource: source,
        includedInBaseline: false,
      }),
      e({ kind: 'meal', name: 'Fixture', mealType: 'lunch', items: [food()] }),
    );
    const d = calculateDay(s, date, now);
    expect(d.ree).toBe(1730);
    expect(d.baselineKcal).toBe(2076);
    expect(d.workouts[0]).toMatchObject({ gross: 160, net: 120, extra: 112 });
    expect(d.totalExpenditure).toBe(2188);
    expect(d.intake.value).toBe(300);
    expect(d.balance?.value).toBe(1888);
  });
  it('운동 포함 기준선에 운동을 두 번 더하지 않는다', () => {
    const s = fixture();
    s.entries = s.entries.map((e) =>
      e.kind === 'baseline' ? { ...e, mode: 'includes_exercise' } : e,
    );
    s.entries.push(
      e({
        kind: 'workout',
        name: 'Fixture',
        minutes: 30,
        met: 4,
        metSource: source,
        includedInBaseline: null,
      }),
    );
    expect(calculateDay(s, date, now).totalExpenditure).toBe(2076);
  });
  it('기준선 포함 여부나 출처가 없으면 추가 소비를 추측하지 않는다', () => {
    const s = fixture();
    s.entries.push(
      e({ kind: 'workout', name: 'Fixture', minutes: 30, met: 4, includedInBaseline: null }),
    );
    const d = calculateDay(s, date, now);
    expect(d.totalExpenditure).toBeNull();
    expect(d.workouts[0].gross).toBeNull();
  });
  it('계획과 중복 운동을 합산하지 않는다', () => {
    const s = fixture();
    s.entries.push(
      e({ kind: 'workout', name: 'planned', status: 'planned', minutes: 30 }),
      e({ kind: 'workout', name: 'duplicate', minutes: 40, duplicateOf: 'original' }),
    );
    expect(calculateDay(s, date, now).workoutMinutes).toBe(0);
  });
  it('범위를 분량과 영양값 모두에 적용한다', () => {
    expect(
      foodEnergy({ ...food(), quantityLow: 120, quantityHigh: 180, kcalLow: 180, kcalHigh: 220 }),
    ).toMatchObject({ value: 300, low: 216, high: 396, estimated: true });
  });
  it('단위와 기준량에 맞춰 계산하고 빈 영양정보는 null이다', () => {
    expect(
      foodEnergy({ ...food(), unit: 'ml', quantity: 250, basisAmount: 100, kcal: 40 }).value,
    ).toBe(100);
    expect(
      foodEnergy({ ...food(), unit: 'serving', quantity: 2, basisAmount: 1, kcal: 40 }).value,
    ).toBe(80);
    expect(foodEnergy({ ...food(), kcal: null }).value).toBeNull();
    expect(mealEnergy([])).toMatchObject({ value: null, unknown: 1, protein: null });
  });
  it('알려진 식사만 합산하되 미상인 음식이 있으면 완성된 날이 아니다', () => {
    const s = fixture();
    s.entries.push(
      e({
        kind: 'meal',
        name: 'partial',
        mealType: 'lunch',
        items: [food(), { ...food(), kcal: null }],
      }),
    );
    const d = calculateDay(s, date, now);
    expect(d.intake.value).toBe(300);
    expect(d.unknownFoods).toBe(1);
    expect(d.mealsComplete).toBe(false);
    expect(d.balance).toBeNull();
  });
  it('현재 날짜에는 완성도와 무관하게 확정 차이를 표시하지 않는다', () => {
    const s = fixture();
    expect(calculateDay(s, date, new Date(date + 'T10:00:00Z')).balance).toBeNull();
  });
  it('식사 0과 미기록을 구분한다', () => {
    const s = fixture();
    expect(calculateDay(s, date, now).intake.value).toBe(0);
    s.entries = s.entries.filter((e) => e.kind !== 'checkin');
    expect(calculateDay(s, date, now).intake.value).toBeNull();
  });
  it('미래 체중·신체정보를 과거로 채우지 않는다', () => {
    const s = fixture();
    s.entries = s.entries.map((e) => ({ ...e, date: '2026-10-08' }));
    const d = calculateDay(s, date, now);
    expect(d.weight).toBeNull();
    expect(d.ree).toBeNull();
  });
  it('같은 날 여러 측정 중 대표값을 쓰고 평균은 측정일만 사용한다', () => {
    const s = fixture();
    s.entries.push(e({ kind: 'weight', kg: 81, representative: true }));
    const summary = summarize(s, '2026-10-01', date, now);
    expect(summary.weightAverage).toBe(81);
    expect(summary.weightDays).toBe(1);
  });
  it('성인식 미확인·18세 미만·오래된 나이 입력에는 대사량을 반환하지 않는다', () => {
    for (const patch of [
      { eligibility: 'unknown' },
      { birthDate: '2015-01-01' },
      { birthDate: undefined, age: 40, ageAsOf: '2024-01-01' },
    ]) {
      const s = fixture();
      s.entries = s.entries.map((e) => (e.kind === 'body' ? ({ ...e, ...patch } as Entry) : e));
      expect(calculateDay(s, date, now).ree).toBeNull();
    }
  });
  it('원본을 바꾸면 같은 날짜가 즉시 재계산된다', () => {
    const s = fixture(),
      a = calculateDay(s, date, now);
    s.entries = s.entries.map((e) => (e.kind === 'weight' ? { ...e, kg: 85 } : e));
    expect(calculateDay(s, date, now).ree! - a.ree!).toBe(50);
  });
  it('개별 음식의 영양소도 실제 섭취량으로 환산한다', () => {
    expect(mealEnergy([{ ...food(), protein: 20, carbs: 30, fat: 5 }])).toMatchObject({
      protein: 30,
      carbs: 45,
      fat: 7.5,
    });
  });
  it('가상 데이터 전체가 실제 입력 스키마에 맞는다', () => {
    for (const row of demoSnapshot().entries) {
      const { id, createdAt, updatedAt, version, actor, deletedAt, ...input } = row;
      expect(inputSchema.safeParse(input).success).toBe(true);
    }
  });
});
describe('날짜와 입력 경계', () => {
  it('한국 자정 경계를 적용한다', () => {
    expect(today(new Date('2026-10-07T14:59:59Z'))).toBe('2026-10-07');
    expect(today(new Date('2026-10-07T15:00:00Z'))).toBe('2026-10-08');
    expect(ageAt('2000-10-08', '2026-10-07')).toBe(25);
  });
  it('잘못된 날짜, 0 기준량, 뒤집힌 범위, 임의 소유자를 거절한다', () => {
    expect(dateSchema.safeParse('2026-02-30').success).toBe(false);
    expect(foodItemSchema.safeParse({ ...food(), basisAmount: 0 }).success).toBe(false);
    expect(foodItemSchema.safeParse({ ...food(), quantityLow: 200 }).success).toBe(false);
    expect(inputSchema.safeParse({ kind: 'weight', date, kg: 80, uid: 'someone' }).success).toBe(
      false,
    );
    expect(() => datesInRange('2026-10-08', '2026-10-07')).toThrow();
  });
});
