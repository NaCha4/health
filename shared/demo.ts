import type { Entry, EntryInput, Snapshot, Source } from './schema.js';
import { today, addDays } from './dates.js';
export const demoSource: Source = {
  kind: 'estimate',
  title: '체험용 가상 영양정보',
  assumptions: '실제 음식의 영양값이 아닙니다.',
};
export function demoSnapshot(): Snapshot {
  const d = today(),
    entries: Entry[] = [];
  const put = (v: EntryInput) => {
    const id = 'demo-' + String(entries.length + 1).padStart(3, '0'),
      at = v.date + 'T03:00:00.000Z';
    entries.push({
      ...v,
      id,
      version: 1,
      createdAt: at,
      updatedAt: at,
      deletedAt: null,
      actor: 'demo',
    });
    return id;
  };
  put({
    kind: 'body',
    date: addDays(d, -35),
    heightCm: 172,
    age: 32,
    ageAsOf: addDays(d, -35),
    coefficient: 'male',
    eligibility: 'adult',
    note: '체험용 가상 신체정보',
  });
  put({
    kind: 'baseline',
    date: addDays(d, -35),
    factor: 1.3,
    mode: 'excludes_exercise',
    description: '앉아서 일하는 날 · 운동은 따로',
    source: { kind: 'user', title: '체험용 생활 활동 가정' },
    note: '',
  });
  put({
    kind: 'goal',
    date: addDays(d, -30),
    title: '꾸준히 기록하는 한 달',
    targetKg: null,
    reviewDate: addDays(d, 14),
    status: 'active',
    note: '숫자보다 기록하는 습관을 먼저 살펴봐요.',
  });
  put({
    kind: 'context',
    date: addDays(d, -30),
    title: '편안하게 이어가는 운동',
    description: '저녁 산책을 선호해요. 체험용 가상 정보입니다.',
    confirmed: true,
    note: '',
  });
  for (let i = -27; i <= 0; i++) {
    const date = addDays(d, i);
    if (i % 4 !== 0 || i === 0)
      put({
        kind: 'weight',
        date,
        kg: Math.round((76.9 - i * 0.038 + Math.sin(i * 1.7) * 0.25) * 10) / 10,
        representative: true,
        fasting: true,
        note: '',
      });
    if (i % 3 !== 1)
      put({
        kind: 'workout',
        date,
        name: i % 2 === 0 ? '저녁 산책' : '가볍게 자전거',
        minutes: i % 2 === 0 ? 40 : 30,
        distanceKm: null,
        met: 3.5,
        referenceMet: 1.3,
        metSource: demoSource,
        includedInBaseline: false,
        status: i === 0 ? 'planned' : 'done',
        note: '',
      });
    const names = ['그릭 요거트와 과일', '닭고기 비빔밥', '두부와 현미밥'];
    for (let m = 0; m < (i === 0 ? 2 : 3); m++)
      put({
        kind: 'meal',
        date,
        name: names[m],
        mealType: (['breakfast', 'lunch', 'dinner'] as const)[m],
        items: [
          {
            name: names[m],
            quantity: 1,
            unit: 'serving',
            basisAmount: 1,
            kcal: [380, 650, 620][m] + (i % 3) * 25,
            kcalLow: [300, 550, 520][m],
            kcalHigh: [430, 740, 710][m],
            protein: [19, 35, 25][m],
            carbs: [40, 85, 75][m],
            fat: [15, 19, 24][m],
            source: demoSource,
          },
        ],
        note: '',
      });
    put({
      kind: 'checkin',
      date,
      mealsComplete: i !== 0 && i % 7 !== 0,
      activityComplete: i !== 0,
      sleepHours: 7.2,
      fatigue: 2,
      hunger: 2,
      note: '',
    });
  }
  const ids = entries
    .filter((e) => e.date >= addDays(d, -7) && e.date < d && e.kind === 'weight')
    .map((e) => e.id);
  const report = put({
    kind: 'analysis',
    date: addDays(d, -1),
    title: '작은 기록이 쌓이고 있어요',
    from: addDays(d, -7),
    to: addDays(d, -1),
    observations:
      '최근 체중은 일별 오르내림이 있지만, 기록을 꾸준히 이어가고 있어요. 하루 숫자보다 일주일 흐름을 함께 살펴보세요.',
    limitations: '체험용 가상 기록으로 작성한 예시입니다. 실제 건강 상태에 대한 분석이 아닙니다.',
    suggestions:
      '다음 주에도 비슷한 시간에 체중을 기록하고, 빠진 식사가 있는 날은 하루 점검에 표시해 보세요.',
    basedOnVersion: entries.length,
    evidenceIds: ids,
    note: '',
  });
  put({
    kind: 'action',
    date: addDays(d, -1),
    title: '아침에 체중을 재고 간단히 기록하기',
    status: 'proposed',
    feedback: '',
    analysisId: report,
    note: '',
  });
  return { entries, version: entries.length };
}
