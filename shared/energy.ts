import type { Entry, FoodItem, Snapshot } from './schema.js';
import { ageAt, datesInRange, daysBetween, isFutureOccurrence, today } from './dates.js';
export const CALCULATION_VERSION = '2026-10-08.2';
export interface Amount {
  value: number | null;
  low: number | null;
  high: number | null;
  estimated: boolean;
}
const empty = (): Amount => ({ value: null, low: null, high: null, estimated: false });
export function foodEnergy(item: FoodItem): Amount {
  if (item.kcal == null) return empty();
  const f = item.quantity / item.basisAmount;
  return {
    value: item.kcal * f,
    low: ((item.kcalLow ?? item.kcal) * (item.quantityLow ?? item.quantity)) / item.basisAmount,
    high: ((item.kcalHigh ?? item.kcal) * (item.quantityHigh ?? item.quantity)) / item.basisAmount,
    estimated:
      item.source.kind === 'estimate' ||
      item.quantityLow != null ||
      item.quantityHigh != null ||
      item.kcalLow != null ||
      item.kcalHigh != null,
  };
}
export function mealEnergy(
  items: FoodItem[],
): Amount & { unknown: number; protein: number | null; carbs: number | null; fat: number | null } {
  const energies = items.map(foodEnergy),
    known = energies.filter((x) => x.value != null);
  const sum = (k: 'value' | 'low' | 'high') =>
    known.length ? known.reduce((s, x) => s + (x[k] ?? 0), 0) : null;
  const nutrient = (k: 'protein' | 'carbs' | 'fat') =>
    items.length && items.every((i) => i[k] != null)
      ? items.reduce((s, i) => s + (i[k]! * i.quantity) / i.basisAmount, 0)
      : null;
  return {
    value: sum('value'),
    low: sum('low'),
    high: sum('high'),
    estimated: known.some((e) => e.estimated),
    unknown: Math.max(1, items.length) - known.length,
    protein: nutrient('protein'),
    carbs: nutrient('carbs'),
    fat: nutrient('fat'),
  };
}
export function latest<K extends Entry['kind']>(
  entries: Entry[],
  kind: K,
  date: string,
): Extract<Entry, { kind: K }> | undefined {
  return entries
    .filter((e) => !e.deletedAt && e.kind === kind && e.date <= date)
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        b.updatedAt.localeCompare(a.updatedAt) ||
        b.id.localeCompare(a.id),
    )[0] as Extract<Entry, { kind: K }> | undefined;
}
export function representative(entries: Entry[], date: string) {
  const w = entries.filter(
    (e): e is Extract<Entry, { kind: 'weight' }> =>
      !e.deletedAt && e.kind === 'weight' && e.date === date,
  );
  return w.sort(
    (a, b) =>
      Number(b.representative) - Number(a.representative) ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.id.localeCompare(b.id),
  )[0];
}
export function calculateDay(snapshot: Snapshot, date: string, now = new Date()) {
  const entries = snapshot.entries.filter((e) => !e.deletedAt),
    day = entries.filter((e) => e.date === date);
  const weightDate = entries
    .filter((e) => e.kind === 'weight' && e.date <= date)
    .map((e) => e.date)
    .sort()
    .at(-1);
  const weight = weightDate ? representative(entries, weightDate) : undefined;
  const body = latest(entries, 'body', date),
    baseline = latest(entries, 'baseline', date),
    checkin = latest(entries, 'checkin', date);
  const check = checkin?.date === date ? checkin : undefined;
  const missing: string[] = [],
    warnings: string[] = [];
  let age: number | null = null;
  if (body?.birthDate) age = ageAt(body.birthDate, date);
  else if (
    body?.age != null &&
    body.ageAsOf &&
    body.ageAsOf <= date &&
    daysBetween(body.ageAsOf, date) < 366
  ) {
    age = body.age;
    warnings.push('나이는 입력 기준일의 만 나이를 사용했습니다.');
  }
  if (!weight) missing.push('체중');
  if (!body?.heightCm) missing.push('키');
  if (age == null) missing.push('나이');
  if (!body || body.coefficient === 'unknown') missing.push('대사식 계수 선택');
  if (body?.eligibility !== 'adult' || (age != null && age < 18))
    missing.push('성인용 계산 적용 확인');
  if (weight && daysBetween(weight.date, date) > 30)
    warnings.push('30일 이상 지난 체중을 사용했습니다.');
  let ree =
    missing.length === 0
      ? 10 * weight!.kg +
        6.25 * body!.heightCm! -
        5 * age! +
        (body!.coefficient === 'male' ? 5 : -161)
      : null;
  if (ree != null && ree <= 0) {
    ree = null;
    missing.push('유효한 신체정보');
  }
  const meals = day.filter((e): e is Extract<Entry, { kind: 'meal' }> => e.kind === 'meal');
  const mealValues = meals.map((m) => ({ id: m.id, ...mealEnergy(m.items) }));
  const knownMeals = mealValues.filter((m) => m.value != null);
  const intake: Amount = { ...empty(), estimated: mealValues.some((m) => m.estimated) };
  if (knownMeals.length)
    for (const key of ['value', 'low', 'high'] as const)
      intake[key] = knownMeals.reduce((s, m) => s + (m[key] ?? 0), 0);
  else if (check?.mealsComplete && meals.length === 0) intake.value = intake.low = intake.high = 0;
  const unknownFoods = mealValues.reduce((s, m) => s + m.unknown, 0);
  const mealsComplete = !!check?.mealsComplete && unknownFoods === 0;
  const workouts = day.filter(
    (e): e is Extract<Entry, { kind: 'workout' }> =>
      e.kind === 'workout' && e.status === 'done' && !e.duplicateOf && !isFutureOccurrence(e, now),
  );
  const workoutValues = workouts.map((w) => {
    const can = !!weight && w.met != null && w.minutes != null && !!w.metSource;
    const gross = can ? (w.met! * weight!.kg * w.minutes!) / 60 : null;
    const net = can ? ((w.met! - 1) * weight!.kg * w.minutes!) / 60 : null;
    const extra =
      w.includedInBaseline === true
        ? 0
        : can && w.includedInBaseline === false && w.referenceMet != null
          ? ((w.met! - w.referenceMet) * weight!.kg * w.minutes!) / 60
          : null;
    return { id: w.id, name: w.name, gross, net, extra };
  });
  const baselineKcal = ree != null && baseline ? ree * baseline.factor : null;
  if (!baseline) missing.push('생활 활동 기준');
  const exerciseMissing =
    baseline?.mode === 'excludes_exercise' && workoutValues.some((w) => w.extra == null);
  if (exerciseMissing) missing.push('운동 시간·강도·기준선 포함 여부');
  const additional =
    baseline?.mode === 'includes_exercise'
      ? 0
      : workoutValues.every((w) => w.extra != null)
        ? workoutValues.reduce((s, w) => s + w.extra!, 0)
        : null;
  const total =
    baselineKcal != null && !exerciseMissing && additional != null
      ? baselineKcal + additional
      : null;
  const isPast = date < today(now);
  const balanceReady =
    isPast && mealsComplete && !!check?.activityComplete && intake.value != null && total != null;
  if (!isPast) warnings.push('소비량은 하루 전체 예상치입니다. 현재까지 소비한 열량이 아닙니다.');
  if (!mealsComplete) warnings.push('식사 기록이 미완료이거나 영양정보가 없는 음식이 있습니다.');
  if (!check?.activityComplete) warnings.push('활동 기록이 완료로 표시되지 않았습니다.');
  warnings.push('소비량은 공식과 활동 가정을 이용한 추정값입니다.');
  const evidenceIds = [
    weight?.id,
    body?.id,
    baseline?.id,
    check?.id,
    ...meals.map((x) => x.id),
    ...workouts.map((x) => x.id),
  ].filter((x): x is string => !!x);
  return {
    date,
    version: snapshot.version,
    formulaVersion: CALCULATION_VERSION,
    calculatedAt: now.toISOString(),
    weight: weight ? { kg: weight.kg, date: weight.date, id: weight.id } : null,
    ree,
    baselineKcal,
    additionalExercise: additional,
    totalExpenditure: total,
    intake,
    unknownFoods,
    mealsComplete,
    activityComplete: !!check?.activityComplete,
    workouts: workoutValues,
    workoutMinutes: workouts.reduce((s, w) => s + (w.minutes ?? 0), 0),
    balance: balanceReady
      ? {
          value: total! - intake.value!,
          low: total! - intake.high!,
          high: total! - intake.low!,
          scope: '섭취량 시나리오 범위이며 소비량의 개인차는 포함하지 않음',
        }
      : null,
    missing: [...new Set(missing)],
    warnings,
    evidenceIds,
    baselineMode: baseline?.mode ?? null,
  };
}
export function summarize(snapshot: Snapshot, from: string, to: string, now = new Date()) {
  const days = datesInRange(from, to).map((d) => calculateDay(snapshot, d, now));
  const weights = datesInRange(from, to)
    .map((d) => representative(snapshot.entries, d))
    .filter((w): w is NonNullable<typeof w> => !!w);
  const complete = days.filter((d) => d.mealsComplete && d.intake.value != null);
  return {
    from,
    to,
    version: snapshot.version,
    calculatedAt: now.toISOString(),
    formulaVersion: CALCULATION_VERSION,
    days,
    weightAverage: weights.length ? weights.reduce((s, w) => s + w.kg, 0) / weights.length : null,
    weightDays: weights.length,
    workoutMinutes: days.reduce((s, d) => s + d.workoutMinutes, 0),
    workoutDays: days.filter((d) => d.workouts.length).length,
    intakeAverage: complete.length
      ? complete.reduce((s, d) => s + d.intake.value!, 0) / complete.length
      : null,
    completeMealDays: complete.length,
    excludedMealDays: days.length - complete.length,
  };
}
