import { z } from 'zod';

export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(v + 'T00:00:00Z');
    return !Number.isNaN(+d) && d.toISOString().slice(0, 10) === v;
  }, '올바른 날짜가 필요합니다.');
const text = z.string().trim().max(4000);
const number = z.number().finite().nonnegative().max(1000000);
const optionalNumber = number.nullable().optional();
export const medicationDoseSources = {
  user: '사용자 본인 확인·진술',
  prescription: '처방전',
  package: '약 봉투·제품 표시',
  clinician: '의료진 안내',
  other: '기타 확인 근거',
} as const;
export const sourceSchema = z
  .object({
    kind: z.enum(['user', 'label', 'official', 'database', 'estimate', 'device']),
    title: z.string().trim().min(1).max(300),
    url: z
      .string()
      .url()
      .refine((v) => /^https?:\/\//.test(v))
      .optional(),
    referenceId: z.string().max(200).optional(),
    retrievedAt: z.string().datetime().optional(),
    assumptions: text.optional(),
  })
  .strict();
export const foodItemSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    quantity: number.max(100000),
    quantityLow: optionalNumber,
    quantityHigh: optionalNumber,
    unit: z.enum(['g', 'ml', 'serving']),
    basisAmount: z.number().min(0.001).max(100000),
    kcal: optionalNumber,
    kcalLow: optionalNumber,
    kcalHigh: optionalNumber,
    protein: optionalNumber,
    carbs: optionalNumber,
    fat: optionalNumber,
    source: sourceSchema,
    preparation: z.string().max(300).optional(),
  })
  .strict()
  .superRefine((v, c) => {
    for (const [low, mid, high] of [
      [v.quantityLow, v.quantity, v.quantityHigh],
      [v.kcalLow, v.kcal, v.kcalHigh],
    ]) {
      if (
        (low != null && high != null && low > high) ||
        (mid != null && ((low != null && low > mid) || (high != null && high < mid)))
      )
        c.addIssue({ code: 'custom', message: '하한 ≤ 대표값 ≤ 상한 순서가 필요합니다.' });
    }
  });
const base = {
  date: dateSchema,
  note: text.default(''),
  occurredAt: z.string().datetime({ offset: true }).optional(),
};
export const inputSchema = z.discriminatedUnion('kind', [
  z
    .object({
      ...base,
      kind: z.literal('medication'),
      date: dateSchema.describe(
        '확인한 일정과 상태의 기록 기준일. 실제 복용 시작일이 아니며 등록 시각은 createdAt입니다.',
      ),
      name: z.string().trim().min(1).max(200),
      dose: z.string().trim().min(1).max(200),
      doseConfirmed: z.literal(true),
      startedOn: dateSchema
        .nullable()
        .optional()
        .describe('실제 복용 시작일. 모르면 null 또는 생략하며 date로 대신 채우지 않습니다.'),
      doseSource: z
        .enum(['user', 'prescription', 'package', 'clinician', 'other'])
        .optional()
        .describe(
          '용량 확인 근거. user는 사용자 본인 확인·진술이며 처방전 확인을 의미하지 않습니다. 생략은 근거 미기록입니다.',
        ),
      route: z.enum(['oral', 'injection', 'other']),
      schedule: z.string().trim().min(1).max(1000),
      status: z.enum(['active', 'paused', 'stopped']),
      previousId: z
        .string()
        .regex(/^[A-Za-z0-9_-]{1,128}$/)
        .optional(),
      changeReason: text.default(''),
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal('dose'),
      medicationId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
      occurredAt: z.string().datetime({ offset: true }),
      status: z.enum(['taken', 'skipped']),
      actualDose: z.string().trim().min(1).max(200).nullable(),
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal('symptom'),
      name: z.string().trim().min(1).max(200),
      severity: z.number().int().min(0).max(10),
      durationMinutes: number.max(525600).nullable().optional(),
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal('sleep'),
      hours: z.number().min(0).max(24),
      quality: z.number().int().min(1).max(5).nullable().optional(),
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal('weight'),
      kg: z.number().min(10).max(600),
      representative: z.boolean().default(false),
      fasting: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal('meal'),
      name: z.string().trim().min(1).max(200),
      mealType: z.enum(['breakfast', 'lunch', 'dinner', 'snack']),
      items: z.array(foodItemSchema).max(60).default([]),
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal('workout'),
      name: z.string().trim().min(1).max(200),
      minutes: number.max(1440).nullable().optional(),
      distanceKm: number.max(1000).nullable().optional(),
      met: z.number().min(0.5).max(30).nullable().optional(),
      referenceMet: z.number().min(0.5).max(30).nullable().optional(),
      metSource: sourceSchema.optional(),
      includedInBaseline: z.boolean().nullable().default(null),
      status: z.enum(['done', 'planned']).default('done'),
      duplicateOf: z.string().max(100).optional(),
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal('body'),
      heightCm: z.number().min(50).max(260).nullable().optional(),
      birthDate: dateSchema.optional(),
      age: z.number().int().min(0).max(120).nullable().optional(),
      ageAsOf: dateSchema.optional(),
      coefficient: z.enum(['male', 'female', 'unknown']).default('unknown'),
      eligibility: z.enum(['adult', 'not_applicable', 'unknown']).default('unknown'),
      bodyFat: number.max(100).nullable().optional(),
      muscleKg: number.max(300).nullable().optional(),
      waistCm: number.max(300).nullable().optional(),
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal('baseline'),
      factor: z.number().min(1).max(3.5),
      mode: z.enum(['excludes_exercise', 'includes_exercise']),
      description: z.string().trim().min(1).max(2000),
      source: sourceSchema,
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal('checkin'),
      mealsComplete: z.boolean().default(false),
      activityComplete: z.boolean().default(false),
      sleepHours: number.max(24).nullable().optional(),
      fatigue: number.max(5).nullable().optional(),
      hunger: number.max(5).nullable().optional(),
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal('goal'),
      title: z.string().trim().min(1).max(300),
      targetKg: z.number().min(10).max(600).nullable().optional(),
      reviewDate: dateSchema.optional(),
      status: z.enum(['active', 'done', 'paused']).default('active'),
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal('context'),
      title: z.string().trim().min(1).max(300),
      description: text,
      confirmed: z.literal(true),
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal('analysis'),
      title: z.string().trim().min(1).max(300),
      from: dateSchema,
      to: dateSchema,
      observations: text,
      hypotheses: text.optional(),
      limitations: text,
      suggestions: text,
      basedOnVersion: z.number().int().nonnegative(),
      evidenceIds: z.array(z.string().max(100)).max(300).default([]),
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal('action'),
      title: z.string().trim().min(1).max(300),
      status: z.enum(['proposed', 'accepted', 'deferred', 'done']).default('proposed'),
      feedback: text.default(''),
      analysisId: z.string().max(100).optional(),
    })
    .strict(),
]);
export type EntryInput = z.infer<typeof inputSchema>;
export type FoodItem = z.infer<typeof foodItemSchema>;
export type Source = z.infer<typeof sourceSchema>;
export type Kind = EntryInput['kind'];
export type Entry = EntryInput & {
  id: string;
  version: number;
  dataVersion?: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  actor: 'web' | 'dot' | 'demo';
};
export interface Snapshot {
  entries: Entry[];
  version: number;
}
export interface Change {
  id: string;
  entryId: string;
  at: string;
  actor: string;
  operation: string;
  before: Entry | null;
  after: Entry | null;
  version: number;
}
export const kinds: Kind[] = [
  'dose',
  'symptom',
  'sleep',
  'medication',
  'weight',
  'meal',
  'workout',
  'body',
  'baseline',
  'checkin',
  'goal',
  'context',
  'analysis',
  'action',
];
export const labels: Record<Kind, string> = {
  medication: '약물·주사 일정',
  dose: '실제 복용·투여',
  symptom: '증상',
  sleep: '수면',
  weight: '체중',
  meal: '식사',
  workout: '운동',
  body: '신체정보',
  baseline: '생활 활동',
  checkin: '하루 점검',
  goal: '목표',
  context: '선호·제약',
  analysis: 'dot 분석',
  action: '실천 항목',
};
export function titleOf(e: EntryInput): string {
  if (e.kind === 'dose')
    return e.status === 'taken' ? `복용·투여 ${e.actualDose ?? ''}` : '미복용·미투여 기록';
  if (e.kind === 'sleep') return `수면 ${e.hours}시간`;
  if (e.kind === 'weight') return `${e.kg} kg`;
  if ('name' in e) return e.name;
  if ('title' in e) return e.title;
  if (e.kind === 'body') return '신체정보 업데이트';
  if (e.kind === 'baseline') return e.description;
  return '하루 기록 점검';
}
