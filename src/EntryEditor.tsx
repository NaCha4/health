import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X, Plus, Trash2, Search, LoaderCircle } from 'lucide-react';
import {
  inputSchema,
  labels,
  type Entry,
  type EntryInput,
  type Kind,
  type FoodItem,
  type Source,
} from '../shared/schema';
import { today, isFutureOccurrence } from '../shared/dates';
import { mealEnergy } from '../shared/energy';
import { inputOf, save, type Api } from './api';
import { EntrySaver } from './entry-save';

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current!;
    d.showModal();
    return () => d.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? 'modal wide' : 'modal'}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button type="button" className="icon-button" aria-label="닫기" onClick={onClose}>
          <X size={22} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function Num({
  value,
  onChange,
  required = false,
  min = 0,
  max,
  step = 'any',
  ...rest
}: {
  value: any;
  onChange: (v: number | null) => void;
  required?: boolean;
  min?: number;
  max?: number;
  step?: string;
  [key: string]: any;
}) {
  return (
    <input
      type="number"
      inputMode="decimal"
      min={min}
      max={max}
      step={step}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      required={required}
      {...rest}
    />
  );
}
const sourceNames = {
  user: '직접 입력',
  label: '제품 영양표',
  official: '공식 자료',
  database: '영양 DB',
  estimate: '추정',
  device: '측정 기기',
};
function SourceFields({ value, onChange }: { value: Source; onChange: (v: Source) => void }) {
  return (
    <div className="source-fields">
      <div className="form-grid">
        <Field label="정보 종류">
          <select
            value={value.kind}
            onChange={(e) => onChange({ ...value, kind: e.target.value as Source['kind'] })}
          >
            {Object.entries(sourceNames).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="출처 또는 판단 근거">
          <input
            value={value.title}
            required
            maxLength={300}
            placeholder="예: 포장지 영양정보"
            onChange={(e) => onChange({ ...value, title: e.target.value })}
          />
        </Field>
      </div>
      <Field label="참고 링크 (선택)">
        <input
          type="url"
          value={value.url ?? ''}
          placeholder="https://"
          onChange={(e) => onChange({ ...value, url: e.target.value || undefined })}
        />
      </Field>
      <Field label="추정한 조건 (선택)">
        <input
          value={value.assumptions ?? ''}
          placeholder="예: 밥 한 공기를 약 200 g으로 추정"
          onChange={(e) => onChange({ ...value, assumptions: e.target.value || undefined })}
        />
      </Field>
    </div>
  );
}
const source = (): Source => ({ kind: 'user', title: '직접 입력' });
const titleForPlan = (e: Entry) =>
  e.kind === 'medication' ? `${e.name} · ${e.dose} · ${e.date}부터` : '';
function defaults(kind: Kind, date: string): Record<string, any> {
  const base = { kind, date, note: '' };
  switch (kind) {
    case 'medication':
      return {
        ...base,
        name: '',
        dose: '',
        doseConfirmed: false,
        route: '',
        schedule: '',
        status: 'active',
        changeReason: '',
      };
    case 'dose':
      return { ...base, medicationId: '', occurredAt: '', status: 'taken', actualDose: null };
    case 'symptom':
      return { ...base, name: '', severity: null, durationMinutes: null };
    case 'sleep':
      return { ...base, hours: null, quality: null };
    case 'weight':
      return { ...base, kg: null, representative: true, fasting: false };
    case 'meal':
      return { ...base, name: '', mealType: 'lunch', items: [] };
    case 'workout':
      return {
        ...base,
        name: '',
        status: date > today() ? 'planned' : 'done',
        minutes: null,
        distanceKm: null,
        met: null,
        referenceMet: null,
        includedInBaseline: null,
      };
    case 'body':
      return {
        ...base,
        heightCm: null,
        coefficient: 'unknown',
        eligibility: 'unknown',
        age: null,
        ageAsOf: date,
      };
    case 'baseline':
      return {
        ...base,
        factor: null,
        mode: 'excludes_exercise',
        description: '',
        source: source(),
      };
    case 'checkin':
      return {
        ...base,
        mealsComplete: false,
        activityComplete: false,
        sleepHours: null,
        fatigue: null,
        hunger: null,
      };
    case 'goal':
      return { ...base, title: '', targetKg: null, status: 'active' };
    case 'context':
      return { ...base, title: '', description: '', confirmed: false };
    case 'analysis':
      return {
        ...base,
        title: '',
        from: date,
        to: date,
        observations: '',
        limitations: '',
        suggestions: '',
        basedOnVersion: 0,
        evidenceIds: [],
      };
    case 'action':
      return { ...base, title: '', status: 'proposed', feedback: '' };
  }
}
export default function EntryEditor({
  api,
  kind,
  date,
  entry,
  initial,
  entries = [],
  version,
  onClose,
  onSaved,
}: {
  api: Api;
  kind: Kind;
  date: string;
  entry?: Entry;
  initial?: EntryInput;
  entries?: Entry[];
  version: number;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<Record<string, any>>(() =>
    entry
      ? inputOf(entry)
      : {
          ...defaults(kind, date),
          ...initial,
          date,
          ...(kind === 'analysis' ? { basedOnVersion: version } : {}),
          ...(kind === 'medication' && initial && 'previousId' in initial
            ? { doseConfirmed: false }
            : {}),
        },
  );
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [query, setQuery] = useState(''),
    [provider, setProvider] = useState('mfds'),
    [searching, setSearching] = useState(false),
    [foodError, setFoodError] = useState(''),
    [foods, setFoods] = useState<Array<{ id: string; name: string; item: FoodItem }>>([]);
  const saver = useRef<EntrySaver | null>(null);
  if (!saver.current)
    saver.current = new EntrySaver(
      (input, target, requestId) => save(api, input, target, requestId),
      entry,
    );
  const patch = (p: Record<string, any>) => {
    setDraft((d) => ({ ...d, ...p }));
    if (!saver.current?.hasPending) setError('');
  };
  const text = (key: string, placeholder = '', required = false) => (
    <input
      value={draft[key] ?? ''}
      placeholder={placeholder}
      required={required}
      onChange={(e) => patch({ [key]: e.target.value || undefined })}
    />
  );
  const number = (key: string, min = 0, max?: number, required = false) => (
    <Num
      value={draft[key]}
      min={min}
      max={max}
      required={required}
      onChange={(v) =>
        patch({
          [key]: v,
          ...(key === 'met' && v != null ? { metSource: draft.metSource ?? source() } : {}),
        })
      }
    />
  );
  const select = (key: string, options: Record<string, string>) => (
    <select value={draft[key] ?? ''} onChange={(e) => patch({ [key]: e.target.value })}>
      {Object.entries(options).map(([k, v]) => (
        <option value={k} key={k}>
          {v}
        </option>
      ))}
    </select>
  );
  const check = (key: string, label: string) => (
    <label className="check">
      <input
        type="checkbox"
        checked={!!draft[key]}
        onChange={(e) => patch({ [key]: e.target.checked })}
      />
      <span>{label}</span>
    </label>
  );
  const area = (key: string, placeholder = '') => (
    <textarea
      value={draft[key] ?? ''}
      placeholder={placeholder}
      rows={3}
      onChange={(e) => patch({ [key]: e.target.value })}
    />
  );
  const foodPatch = (index: number, p: Partial<FoodItem>) =>
    patch({
      items: draft.items.map((f: FoodItem, i: number) => (i === index ? { ...f, ...p } : f)),
    });
  const addFood = (item?: FoodItem) =>
    patch({
      items: [
        ...draft.items,
        item ?? {
          name: '',
          quantity: 1,
          unit: 'serving',
          basisAmount: 1,
          kcal: null,
          source: source(),
        },
      ],
    });
  const search = async () => {
    setSearching(true);
    setFoodError('');
    try {
      const r = await api.get<{ foods: typeof foods }>(
        '/nutrition?provider=' + provider + '&query=' + encodeURIComponent(query),
      );
      setFoods(r.foods);
      if (!r.foods.length)
        setFoodError('검색 결과가 없어요. 다른 이름으로 찾거나 직접 입력해 주세요.');
    } catch (e) {
      setFoodError((e as Error).message);
    } finally {
      setSearching(false);
    }
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const input = inputSchema.parse(draft);
      if (input.kind === 'dose' && isFutureOccurrence(input))
        throw new Error('실제 복용·미복용 기록은 미래 시각에 저장할 수 없습니다.');
      if (input.kind === 'dose' && input.status === 'taken' && !input.actualDose)
        throw new Error('실제 복용·투여량을 입력하세요.');
      await saver.current!.save(input);
      await onSaved();
      onClose();
    } catch (e) {
      setError(
        e instanceof Error
          ? 'issues' in e
            ? '입력값을 확인해 주세요. 필수 값, 날짜, 추정 범위의 순서를 살펴보세요.'
            : e.message
          : '저장하지 못했습니다.',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={labels[kind] + (entry ? ' 수정' : ' 기록')}
      onClose={() => {
        if (!busy) onClose();
      }}
      wide={kind === 'meal'}
    >
      <form onSubmit={submit}>
        <fieldset
          className="modal-body"
          disabled={busy}
          style={{ border: 0, margin: 0, minWidth: 0 }}
        >
          <Field
            label={['body', 'baseline', 'medication'].includes(kind) ? '적용 시작일' : '기록 날짜'}
          >
            <input
              type="date"
              value={draft.date}
              required
              onChange={(e) =>
                patch({
                  date: e.target.value,
                  occurredAt: draft.occurredAt
                    ? e.target.value +
                      'T' +
                      new Date(draft.occurredAt).toLocaleTimeString('en-GB', {
                        timeZone: 'Asia/Seoul',
                        hour: '2-digit',
                        minute: '2-digit',
                      }) +
                      ':00+09:00'
                    : undefined,
                })
              }
            />
          </Field>
          {['weight', 'meal', 'workout', 'dose', 'symptom', 'sleep'].includes(kind) && (
            <Field
              label={
                kind === 'dose'
                  ? '실제 복용·미복용 시각 (한국 시간)'
                  : '실제 시각 (선택, 한국 시간)'
              }
            >
              <input
                type="time"
                required={kind === 'dose'}
                value={
                  draft.occurredAt && !Number.isNaN(Date.parse(draft.occurredAt))
                    ? new Date(draft.occurredAt).toLocaleTimeString('en-GB', {
                        timeZone: 'Asia/Seoul',
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : ''
                }
                onChange={(e) =>
                  patch({
                    occurredAt: e.target.value
                      ? draft.date + 'T' + e.target.value + ':00+09:00'
                      : undefined,
                  })
                }
              />
            </Field>
          )}
          {kind === 'medication' && (
            <>
              {draft.previousId && (
                <p className="help">
                  이전 처방은 그대로 보존됩니다. 새 적용일부터의 전체 일정과 상태를 확인하세요.
                </p>
              )}
              <Field label="약물·주사 이름">{text('name', '', true)}</Field>
              <Field
                label="확인한 처방 용량"
                hint="단위까지 직접 적어 주세요. 예시 값은 자동으로 채우지 않아요."
              >
                {text('dose', '', true)}
              </Field>
              {check('doseConfirmed', '처방전·약 봉투 등에서 이 용량을 직접 확인했어요')}
              <Field label="투여 경로">
                {select('route', {
                  '': '선택해 주세요',
                  oral: '경구',
                  injection: '주사',
                  other: '기타',
                })}
              </Field>
              <Field
                label="처방 일정"
                hint="횟수·시간·요일·간격 또는 필요 시 복용 조건을 처방받은 내용대로 적어 주세요."
              >
                <textarea
                  required
                  value={draft.schedule ?? ''}
                  onChange={(e) => patch({ schedule: e.target.value })}
                />
              </Field>
              <Field label="적용일부터의 상태">
                {select('status', { active: '복용 중', paused: '일시 중단', stopped: '중단' })}
              </Field>
              <Field label="변경·중단 사유 (선택)">{area('changeReason')}</Field>
            </>
          )}
          {kind === 'dose' && (
            <>
              <Field label="당시 처방 일정">
                <select
                  required
                  value={draft.medicationId ?? ''}
                  onChange={(e) => patch({ medicationId: e.target.value })}
                >
                  <option value="">처방을 선택해 주세요</option>
                  {entries
                    .filter((e) => e.kind === 'medication' && !e.deletedAt && e.date <= draft.date)
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        {titleForPlan(e)}
                      </option>
                    ))}
                </select>
              </Field>
              {!entries.some((e) => e.kind === 'medication' && !e.deletedAt) && (
                <p className="help">약물·주사 화면에서 확인한 처방 일정을 먼저 등록해 주세요.</p>
              )}
              <Field label="실제 복용 여부">
                <select
                  value={draft.status}
                  onChange={(e) =>
                    patch({
                      status: e.target.value,
                      ...(e.target.value === 'skipped' ? { actualDose: null } : {}),
                    })
                  }
                >
                  <option value="taken">복용·투여했어요</option>
                  <option value="skipped">복용·투여하지 않았어요</option>
                </select>
              </Field>
              {draft.status === 'taken' && (
                <Field
                  label="실제 복용·투여량"
                  hint="처방 용량과 다르면 실제 사용한 양을 기록하세요."
                >
                  {text('actualDose', '', true)}
                </Field>
              )}
            </>
          )}
          {kind === 'symptom' && (
            <>
              <Field label="느낀 증상">{text('name', '', true)}</Field>
              <Field label="증상 강도 (0~10)" hint="0은 증상이 없었음을 직접 남긴 기록입니다.">
                {number('severity', 0, 10, true)}
              </Field>
              <Field label="지속 시간 (분, 선택)">{number('durationMinutes', 0, 525600)}</Field>
            </>
          )}
          {kind === 'sleep' && (
            <>
              <p className="help">
                잠에서 깬 날짜에 하루 총수면 시간을 기록하세요. 같은 날짜의 여러 기록은 합산하지
                않아요.
              </p>
              <Field label="총수면 시간">{number('hours', 0, 24, true)}</Field>
              <Field label="수면 만족도 (1~5, 선택)">{number('quality', 1, 5)}</Field>
            </>
          )}
          {kind === 'weight' && (
            <>
              <Field label="몸무게 (kg)">{number('kg', 10, 600, true)}</Field>
              {check('representative', '이날의 대표 체중으로 사용')}
              {check('fasting', '공복에 측정했어요')}
            </>
          )}
          {kind === 'meal' && (
            <>
              <div className="form-grid">
                <Field label="어떤 식사였나요?">{text('name', '예: 현미밥과 닭고기', true)}</Field>
                <Field label="식사 구분">
                  {select('mealType', {
                    breakfast: '아침',
                    lunch: '점심',
                    dinner: '저녁',
                    snack: '간식',
                  })}
                </Field>
              </div>
              <p className="help">
                이름만 먼저 기록해도 좋아요. 음식별 양과 영양정보를 더하면 섭취량이 계산됩니다.
              </p>
              <div className="food-search">
                <div className="form-grid">
                  <Field label="식품 DB">
                    <select value={provider} onChange={(e) => setProvider(e.target.value)}>
                      <option value="mfds">식약처</option>
                      <option value="usda">USDA (영문 검색)</option>
                    </select>
                  </Field>
                  <Field label="찾을 음식">
                    <div className="input-action">
                      <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="음식 이름"
                      />
                      <button
                        type="button"
                        className="icon-button"
                        aria-label="음식 검색"
                        disabled={searching || query.trim().length < 2}
                        onClick={search}
                      >
                        {searching ? (
                          <LoaderCircle className="spin" size={18} />
                        ) : (
                          <Search size={18} />
                        )}
                      </button>
                    </div>
                  </Field>
                </div>
                {foodError && (
                  <p className="help" role="status">
                    {foodError}
                  </p>
                )}
                {foods.length > 0 && (
                  <div className="search-results">
                    {foods.map((f) => (
                      <button
                        type="button"
                        key={f.id}
                        onClick={() => {
                          addFood(f.item);
                          setFoods([]);
                        }}
                      >
                        <span>{f.name}</span>
                        <span>
                          {f.item.kcal ?? '미상'} kcal / {f.item.basisAmount} {f.item.unit}
                        </span>
                        <Plus size={16} />
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {draft.items.map((f: FoodItem, i: number) => (
                <section key={i} className="food-card">
                  <div className="section-line">
                    <h3>음식 {i + 1}</h3>
                    <button
                      className="icon-button"
                      type="button"
                      aria-label={`음식 ${i + 1} 제거`}
                      onClick={() =>
                        patch({ items: draft.items.filter((_: unknown, j: number) => j !== i) })
                      }
                    >
                      <Trash2 size={17} />
                    </button>
                  </div>
                  <Field label="음식 이름">
                    <input
                      required
                      value={f.name}
                      onChange={(e) => foodPatch(i, { name: e.target.value })}
                    />
                  </Field>
                  <div className="form-grid thirds">
                    <Field label="먹은 양">
                      <Num
                        value={f.quantity}
                        required
                        onChange={(v) => foodPatch(i, { quantity: v as number })}
                      />
                    </Field>
                    <Field label="단위">
                      <select
                        value={f.unit}
                        onChange={(e) => foodPatch(i, { unit: e.target.value as FoodItem['unit'] })}
                      >
                        <option value="serving">회 제공량</option>
                        <option value="g">g</option>
                        <option value="ml">ml</option>
                      </select>
                    </Field>
                    <Field label="영양정보 기준량">
                      <Num
                        value={f.basisAmount}
                        min={0.001}
                        required
                        onChange={(v) => foodPatch(i, { basisAmount: v as number })}
                      />
                    </Field>
                  </div>
                  <Field
                    label="기준량당 열량 (kcal)"
                    hint="모르면 비워 두세요. 먹은 양 ÷ 기준량 × 열량으로 계산합니다."
                  >
                    <Num value={f.kcal} onChange={(v) => foodPatch(i, { kcal: v })} />
                  </Field>
                  <details>
                    <summary>영양소·추정 범위·조리법</summary>
                    <div className="form-grid thirds">
                      {(['protein', 'carbs', 'fat'] as const).map((key, j) => (
                        <Field key={key} label={['단백질 (g)', '탄수화물 (g)', '지방 (g)'][j]}>
                          <Num value={f[key]} onChange={(v) => foodPatch(i, { [key]: v })} />
                        </Field>
                      ))}
                    </div>
                    <div className="form-grid">
                      {(['quantityLow', 'quantityHigh', 'kcalLow', 'kcalHigh'] as const).map(
                        (key, j) => (
                          <Field
                            key={key}
                            label={
                              ['먹은 양 하한', '먹은 양 상한', '기준 열량 하한', '기준 열량 상한'][
                                j
                              ]
                            }
                          >
                            <Num value={f[key]} onChange={(v) => foodPatch(i, { [key]: v })} />
                          </Field>
                        ),
                      )}
                    </div>
                    <Field label="조리법">
                      <input
                        value={f.preparation ?? ''}
                        onChange={(e) => foodPatch(i, { preparation: e.target.value })}
                      />
                    </Field>
                  </details>
                  <details>
                    <summary>출처와 추정 근거</summary>
                    <SourceFields value={f.source} onChange={(v) => foodPatch(i, { source: v })} />
                  </details>
                </section>
              ))}
              <button className="button secondary full" type="button" onClick={() => addFood()}>
                <Plus size={17} /> 음식 직접 추가
              </button>
              {draft.items.length > 0 && (
                <p className="calculation-preview">
                  현재 합계{' '}
                  <strong>{mealEnergy(draft.items).value?.toFixed(0) ?? '미상'} kcal</strong> ·
                  영양정보 미상 {mealEnergy(draft.items).unknown}개
                </p>
              )}
            </>
          )}
          {kind === 'workout' && (
            <>
              <Field label="어떤 운동을 했나요?">{text('name', '예: 저녁 산책', true)}</Field>
              <div className="form-grid">
                <Field label="시간 (분)">{number('minutes', 0, 1440)}</Field>
                <Field label="거리 (km, 선택)">{number('distanceKm', 0, 1000)}</Field>
              </div>
              <Field label="진행 상태">{select('status', { done: '완료', planned: '계획' })}</Field>
              <details open={!!draft.met}>
                <summary>소비 열량 계산에 사용할 정보</summary>
                <p className="help">
                  운동 강도와 비교할 평소 활동이 있어야 추가 소비량을 계산할 수 있어요. dot가 근거를
                  찾아 채울 수도 있습니다.
                </p>
                <div className="form-grid">
                  <Field label="운동 강도 (MET)">{number('met', 0.5, 30)}</Field>
                  <Field label="대체한 평소 활동 (MET)">{number('referenceMet', 0.5, 30)}</Field>
                </div>
                <Field label="생활 활동 기준선에 포함되어 있나요?">
                  <select
                    value={
                      draft.includedInBaseline === null
                        ? 'unknown'
                        : String(draft.includedInBaseline)
                    }
                    onChange={(e) =>
                      patch({
                        includedInBaseline:
                          e.target.value === 'unknown' ? null : e.target.value === 'true',
                      })
                    }
                  >
                    <option value="unknown">아직 모름</option>
                    <option value="false">별도로 한 운동이에요</option>
                    <option value="true">이미 포함되어 있어요</option>
                  </select>
                </Field>
                {draft.met != null && (
                  <SourceFields
                    value={draft.metSource ?? source()}
                    onChange={(v) => patch({ metSource: v })}
                  />
                )}
                <Field
                  label="중복 기록의 원본 ID (선택)"
                  hint="같은 활동이 두 번 들어왔을 때만 입력합니다."
                >
                  {text('duplicateOf')}
                </Field>
              </details>
            </>
          )}
          {kind === 'body' && (
            <>
              <Field label="키 (cm)">{number('heightCm', 50, 260)}</Field>
              <div className="form-grid">
                <Field label="생년월일 (선택)">
                  <input
                    type="date"
                    value={draft.birthDate ?? ''}
                    onChange={(e) => patch({ birthDate: e.target.value || undefined })}
                  />
                </Field>
                <Field label="또는 기준일의 만 나이">{number('age', 0, 120)}</Field>
              </div>
              {draft.age != null && (
                <Field label="나이 기준일">
                  <input
                    type="date"
                    value={draft.ageAsOf ?? draft.date}
                    onChange={(e) => patch({ ageAsOf: e.target.value })}
                  />
                </Field>
              )}
              <Field label="Mifflin–St Jeor 식에 사용할 계수">
                {select('coefficient', {
                  unknown: '선택하지 않음',
                  male: '남성식 (+5)',
                  female: '여성식 (−161)',
                })}
              </Field>
              <Field
                label="성인용 일반 추정식 적용 여부"
                hint="18세 이상 일반 성인용입니다. 임신·수유 등 별도 평가가 필요하면 적용하지 않음을 선택하세요."
              >
                {select('eligibility', {
                  unknown: '아직 확인하지 않음',
                  adult: '일반 성인용 식 적용',
                  not_applicable: '적용하지 않음',
                })}
              </Field>
              <div className="form-grid thirds">
                <Field label="체지방률 (%)">{number('bodyFat', 0, 100)}</Field>
                <Field label="근육량 (kg)">{number('muscleKg', 0, 300)}</Field>
                <Field label="허리둘레 (cm)">{number('waistCm', 0, 300)}</Field>
              </div>
            </>
          )}
          {kind === 'baseline' && (
            <>
              <Field label="생활 활동 설명">
                {text('description', '예: 대부분 앉아서 일하고 짧게 이동', true)}
              </Field>
              <Field
                label="안정 시 대사량에 곱할 활동 계수"
                hint="자동으로 정하지 않습니다. 적용 근거와 운동 포함 여부를 함께 기록하세요."
              >
                {number('factor', 1, 3.5, true)}
              </Field>
              <Field label="운동 포함 방식">
                {select('mode', {
                  excludes_exercise: '별도 운동 제외 · 추가 소비만 더하기',
                  includes_exercise: '운동까지 포함 · 운동 열량 더하지 않기',
                })}
              </Field>
              <SourceFields value={draft.source} onChange={(v) => patch({ source: v })} />
            </>
          )}
          {kind === 'checkin' && (
            <>
              <div className="check-group">
                {check('mealsComplete', '이날 먹은 것을 모두 기록했어요')}
                {check('activityComplete', '이날의 활동 기록을 마쳤어요')}
              </div>
              <p className="help">
                완료 표시는 기록한 내용에 대한 확인입니다. 식사 정보가 빠진 날의 에너지 차이는
                확정하지 않습니다.
              </p>
              <div className="form-grid thirds">
                <Field label="수면 (시간)">{number('sleepHours', 0, 24)}</Field>
                <Field label="피로 (0~5)">{number('fatigue', 0, 5)}</Field>
                <Field label="허기 (0~5)">{number('hunger', 0, 5)}</Field>
              </div>
            </>
          )}
          {['goal', 'context', 'analysis', 'action'].includes(kind) && (
            <Field label="제목">{text('title', '', true)}</Field>
          )}
          {kind === 'goal' && (
            <>
              <Field label="목표 체중 (kg, 선택)">{number('targetKg', 10, 600)}</Field>
              <Field label="다시 살펴볼 날짜 (선택)">
                <input
                  type="date"
                  value={draft.reviewDate ?? ''}
                  onChange={(e) => patch({ reviewDate: e.target.value || undefined })}
                />
              </Field>
              <Field label="상태">
                {select('status', { active: '진행 중', done: '완료', paused: '잠시 쉬기' })}
              </Field>
            </>
          )}
          {kind === 'context' && (
            <>
              <Field label="내용">
                {area('description', '좋아하는 음식, 운동, 일정이나 고려할 점')}
              </Field>
              {check('confirmed', 'dot가 참고할 정보로 저장할게요')}
            </>
          )}
          {kind === 'analysis' && (
            <>
              <div className="form-grid">
                <Field label="분석 시작일">
                  <input
                    type="date"
                    value={draft.from}
                    onChange={(e) => patch({ from: e.target.value })}
                  />
                </Field>
                <Field label="분석 종료일">
                  <input
                    type="date"
                    value={draft.to}
                    onChange={(e) => patch({ to: e.target.value })}
                  />
                </Field>
              </div>
              <Field label="관찰">{area('observations')}</Field>
              <Field label="가설 · 가능한 설명">{area('hypotheses')}</Field>
              <Field label="한계와 불확실성">{area('limitations')}</Field>
              <Field label="제안">{area('suggestions')}</Field>
              <Field label="근거 기록 ID (쉼표 구분)">
                <input
                  value={draft.evidenceIds.join(', ')}
                  onChange={(e) =>
                    patch({
                      evidenceIds: e.target.value
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </Field>
              <p className="help">기준 데이터 버전 {draft.basedOnVersion}</p>
            </>
          )}
          {kind === 'action' && (
            <>
              <Field label="상태">
                {select('status', {
                  proposed: '검토할 제안',
                  accepted: '해볼게요',
                  deferred: '나중에',
                  done: '완료',
                })}
              </Field>
              <Field label="실천 후 메모">{area('feedback')}</Field>
            </>
          )}
          <Field label="메모 (선택)">{area('note')}</Field>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </fieldset>
        <div className="modal-footer">
          <button type="button" className="button secondary" disabled={busy} onClick={onClose}>
            취소
          </button>
          <button type="submit" className="button primary" disabled={busy}>
            {busy ? (
              <>
                <LoaderCircle className="spin" size={17} /> 저장 중
              </>
            ) : (
              '기록 저장'
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
