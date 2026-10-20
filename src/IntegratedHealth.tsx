import { useState } from 'react';
import { Activity, ArrowRight, Moon, Pill, Plus, Syringe, Download, Link2 } from 'lucide-react';
import { addDays } from '../shared/dates';
import {
  compareHealth,
  medicationPlans,
  sleepForDay,
  timeline,
  timelineCsv,
  type Medication,
} from '../shared/integrated';
import { titleOf, type Entry, type EntryInput, type Kind, type Snapshot } from '../shared/schema';
import { inputOf } from './api';
import { Field } from './EntryEditor';

const n = (v: number | null) =>
  v == null ? '미기록' : v.toLocaleString('ko-KR', { maximumFractionDigits: 1 });
const status = { active: '복용 중', paused: '일시 중단', stopped: '중단' };
export function HealthOverview({
  snapshot,
  date,
  add,
  openMedications,
}: {
  snapshot: Snapshot;
  date: string;
  add: (k: Kind) => void;
  openMedications: () => void;
}) {
  const sleep = sleepForDay(snapshot.entries, date),
    plans = medicationPlans(snapshot.entries, date),
    doses = snapshot.entries.filter(
      (e) => !e.deletedAt && e.date === date && e.kind === 'dose' && e.status === 'taken',
    ),
    symptoms = snapshot.entries.filter(
      (e) => !e.deletedAt && e.date === date && e.kind === 'symptom',
    );
  return (
    <section className="health-overview" aria-label="통합 건강 대시보드">
      <button className="health-stat" onClick={openMedications}>
        <span className="health-stat-icon lavender">
          <Pill size={22} />
        </span>
        <span>
          <small>약물·주사</small>
          <strong>{plans.filter((p) => p.status === 'active').length}개 일정</strong>
          <em>실제 복용·투여 {doses.length}회 기록</em>
        </span>
        <ArrowRight size={16} />
      </button>
      <button className="health-stat" onClick={() => add('sleep')}>
        <span className="health-stat-icon blue">
          <Moon size={22} />
        </span>
        <span>
          <small>수면</small>
          <strong>{sleep ? `${n(sleep.hours)}시간` : '미기록'}</strong>
          <em>
            {sleep?.entry.kind === 'checkin' ? '하루 점검 기록 기준' : '해당 날짜의 수면 기록'}
          </em>
        </span>
        <Plus size={16} />
      </button>
      <button className="health-stat" onClick={() => add('symptom')}>
        <span className="health-stat-icon peach">
          <Activity size={22} />
        </span>
        <span>
          <small>몸의 신호</small>
          <strong>{symptoms.length ? `${symptoms.length}건 기록` : '기록 없음'}</strong>
          <em>느낀 증상과 강도를 남겨요</em>
        </span>
        <Plus size={16} />
      </button>
    </section>
  );
}
export function MedicationPanel({
  snapshot,
  date,
  add,
  revise,
  detail,
}: {
  snapshot: Snapshot;
  date: string;
  add: (k: Kind) => void;
  revise: (input: EntryInput) => void;
  detail: (id: string) => void;
}) {
  const plans = medicationPlans(snapshot.entries, date),
    history = snapshot.entries
      .filter((e): e is Medication => e.kind === 'medication' && !e.deletedAt)
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">MEDICATION & CARE</span>
          <h1>약물과 주사, 나의 기록</h1>
          <p>처방 일정과 실제 복용을 구분해 차곡차곡 남겨요.</p>
        </div>
        <button className="button primary" onClick={() => add('medication')}>
          <Plus size={17} />
          일정 등록
        </button>
      </div>
      <div className="medication-intro">
        <Pill size={24} />
        <p>
          이름·확인한 용량·처방 일정을 직접 등록하면 실제 복용 기록을 연결할 수 있어요. 변경·중단은
          새 이력으로 남겨요.
        </p>
      </div>
      <p className="help">
        {date} 기준 일정 · 자유롭게 적은 처방 일정으로 예정 횟수나 미복용 여부를 자동 추정하지
        않아요.
      </p>
      {plans.length ? (
        <div className="medication-grid">
          {plans.map((p) => (
            <article className="card medication-card" key={p.id}>
              <div className="section-line">
                <span className="medication-symbol">
                  {p.route === 'injection' ? <Syringe size={22} /> : <Pill size={22} />}
                </span>
                <span className="tag">{status[p.status]}</span>
              </div>
              <h2>{p.name}</h2>
              <p className="medication-dose">{p.dose}</p>
              <p>{p.schedule}</p>
              <p className="help">
                {p.date}부터 ·{' '}
                {p.route === 'oral' ? '경구' : p.route === 'injection' ? '주사' : '기타'} · 사용자
                용량 확인
              </p>
              {p.changeReason && <p className="help">변경 사유: {p.changeReason}</p>}
              <div className="button-row">
                <button
                  className="button primary small"
                  onClick={() =>
                    revise({
                      kind: 'dose',
                      date,
                      note: '',
                      medicationId: p.id,
                      status: 'taken',
                      actualDose: null,
                      occurredAt: '',
                    })
                  }
                >
                  실제 복용 기록
                </button>
                <button
                  className="button secondary small"
                  onClick={() =>
                    revise({
                      ...inputOf(p),
                      date,
                      previousId: p.id,
                      changeReason: '',
                    } as EntryInput)
                  }
                >
                  변경·중단 남기기
                </button>
                <button className="text-button" onClick={() => detail(p.id)}>
                  상세
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="card empty-state">
          <Pill size={32} />
          <h3>등록한 약물·주사 일정이 없어요.</h3>
          <p>약 이름이나 증상을 대신 채우지 않습니다. 준비되면 첫 일정을 남겨 주세요.</p>
        </div>
      )}
      <section className="card medication-history">
        <h2>처방 변경·중단 이력</h2>
        <p className="help">
          이전 일정을 보존한 채 새 적용일과 상태를 추가합니다. 각 기록의 실제 투여는 당시 처방에
          연결됩니다.
        </p>
        {history.length ? (
          history.map((p) => (
            <button className="medication-history-row" key={p.id} onClick={() => detail(p.id)}>
              <span>{p.date}</span>
              <strong>
                {p.name} · {p.dose}
              </strong>
              <span>
                {status[p.status]}
                {p.previousId ? ' · 변경' : ' · 최초'}
              </span>
              <ArrowRight size={14} />
            </button>
          ))
        ) : (
          <p className="help">아직 이력이 없어요.</p>
        )}
      </section>
    </>
  );
}
export function IntegratedSummary({
  snapshot,
  date,
  detail,
}: {
  snapshot: Snapshot;
  date: string;
  detail: (id: string) => void;
}) {
  const [days, setDays] = useState(7),
    [custom, setCustom] = useState(false),
    [from, setFrom] = useState(addDays(date, -6)),
    [to, setTo] = useState(date);
  const start = custom ? from : addDays(date, 1 - days),
    end = custom ? to : date;
  const valid =
    !!start && !!end && start <= end && (+new Date(end) - +new Date(start)) / 86400000 <= 365;
  const comparison = valid ? compareHealth(snapshot, start, end) : null,
    c = comparison?.current;
  const delta = (v: number | null | undefined, unit: string) =>
    v == null
      ? '이전 기간과 비교할 기록 부족'
      : `이전 같은 기간보다 ${v > 0 ? '+' : ''}${n(v)}${unit}`;
  const exportRows = () => {
    const blob = new Blob([timelineCsv(snapshot.entries, start, end)], {
        type: 'text/csv;charset=utf-8',
      }),
      url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = `harugyeol-timeline-${start}-${end}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section className="card integrated-summary">
      <div className="section-line">
        <h2>기록에서 보이는 변화</h2>
        <span className="tag">규칙 기반 요약</span>
      </div>
      <div className="period-toolbar">
        <div className="button-row">
          {[7, 30, 90].map((d) => (
            <button
              className={'chip ' + (!custom && days === d ? 'selected' : '')}
              key={d}
              onClick={() => {
                setDays(d);
                setCustom(false);
              }}
            >
              {d}일
            </button>
          ))}
          <button className={'chip ' + (custom ? 'selected' : '')} onClick={() => setCustom(true)}>
            직접 선택
          </button>
        </div>
        <button className="text-button" disabled={!valid} onClick={exportRows}>
          <Download size={15} />
          기간 기록 CSV
        </button>
      </div>
      {custom && (
        <div className="form-grid">
          <Field label="요약 시작일">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="요약 종료일">
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
      )}
      {!valid ? (
        <p className="error">시작일과 종료일을 366일 이내로 선택해 주세요.</p>
      ) : (
        c && (
          <>
            <p className="help">
              {start} — {end} · 이전 {c.days}일과 비교 · 누락일은 0으로 채우지 않아요.
            </p>
            <div className="health-summary-grid">
              <div>
                <small>평균 체중</small>
                <strong>
                  {n(c.weightAverage)}
                  {c.weightAverage != null ? ' kg' : ''}
                </strong>
                <p>
                  {c.weightDays}/{c.days}일 측정
                </p>
                <em>{delta(comparison?.weightDelta, ' kg')}</em>
              </div>
              <div>
                <small>평균 수면</small>
                <strong>
                  {n(c.sleepAverage)}
                  {c.sleepAverage != null ? '시간' : ''}
                </strong>
                <p>
                  {c.sleepDays}/{c.days}일 기록
                </p>
                <em>{delta(comparison?.sleepDelta, '시간')}</em>
              </div>
              <div>
                <small>증상 기록</small>
                <strong>{c.symptomCount}건</strong>
                <p>
                  {c.symptomDays}일 기록 · 평균 강도 {n(c.severityAverage)}
                </p>
                <em>미기록일의 증상 유무는 알 수 없어요.</em>
              </div>
              <div>
                <small>실제 복용·투여</small>
                <strong>{c.taken}회</strong>
                <p>미복용·미투여로 남긴 기록 {c.skipped}회</p>
                <em>기록 횟수 기준 · 복용률은 계산하지 않아요.</em>
              </div>
            </div>
            <details className="pattern-notes" open={c.patternEvidence.length > 0}>
              <summary>관찰, 가능한 설명과 근거</summary>
              <h3>관찰 사실</h3>
              <p>
                {c.symptomDays
                  ? `증상을 기록한 ${c.symptomDays}일 중 ${c.overlapDays}일이 실제 투여를 기록한 당일 또는 다음 날과 겹쳤어요.`
                  : '이 기간에 등록한 증상 기록이 없어요.'}
              </p>
              <h3>가설 · 가능한 설명</h3>
              <p>
                {c.overlapDays
                  ? '투여 시점과 몸의 변화가 함께 움직이는지 살펴볼 후보예요. 수면·식사·활동 변화나 기록을 남긴 날의 차이도 이 겹침을 설명할 수 있어요.'
                  : '현재 기록에서 투여 시점과 증상이 겹치는 패턴을 제시할 근거가 부족해요.'}
              </p>
              <h3>근거와 불확실성</h3>
              <p>
                날짜가 겹친 횟수를 센 결과입니다. 증상이 없던 날의 기록, 투여 전후의 정확한 시각과
                반복 비교가 부족할 수 있어요. 같은 날에는 증상이 먼저 생겼을 수도 있어 인과 방향은
                알 수 없어요.
              </p>
              <div className="evidence-links">
                {c.patternEvidence.slice(0, 20).map((id) => (
                  <button key={id} className="chip" onClick={() => detail(id)}>
                    <Link2 size={12} />
                    {titleOf(snapshot.entries.find((e) => e.id === id)!)}
                  </button>
                ))}
              </div>
            </details>
            <p className="help">
              수면은 날짜별 최신 수면 기록을 사용하고, 없으면 기존 하루 점검의 수면을 사용합니다.
              AI의 해석은 연결된 dot에 요청하고 저장된 분석 노트에서 확인하세요.
            </p>
          </>
        )
      )}
    </section>
  );
}
export function Timeline({
  snapshot,
  date,
  render,
}: {
  snapshot: Snapshot;
  date: string;
  render: (entry: Entry) => React.ReactNode;
}) {
  const [days, setDays] = useState(7),
    [expanded, setExpanded] = useState(false),
    rows = timeline(snapshot.entries, addDays(date, 1 - days), date);
  return (
    <section className="card integrated-timeline">
      <div className="section-line">
        <h2>건강 타임라인</h2>
        <select
          aria-label="타임라인 기간"
          value={days}
          onChange={(e) => {
            setDays(Number(e.target.value));
            setExpanded(false);
          }}
        >
          <option value={1}>하루</option>
          <option value={7}>7일</option>
          <option value={30}>30일</option>
        </select>
      </div>
      <p className="help">식사·체중·수면·증상·처방 변경과 실제 투여를 한 흐름으로 봐요.</p>
      {rows.length ? (
        rows.slice(0, expanded ? 100 : 12).map((e) => (
          <div className="timeline-event" key={e.id}>
            <span className="timeline-stamp">
              {e.date.slice(5).replace('-', '.')}
              <small>
                {e.occurredAt
                  ? new Date(e.occurredAt).toLocaleTimeString('ko-KR', {
                      timeZone: 'Asia/Seoul',
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false,
                    })
                  : '시각 미기록'}
              </small>
            </span>
            {render(e)}
          </div>
        ))
      ) : (
        <div className="empty-state">
          <Activity size={28} />
          <p>아직 이 기간의 기록이 없어요.</p>
        </div>
      )}
      {rows.length > 12 && (
        <button className="text-button" onClick={() => setExpanded((v) => !v)}>
          {expanded ? '간략히 보기' : `기록 더 보기 · 전체 ${rows.length}건`}
        </button>
      )}
      {expanded && rows.length > 100 && (
        <p className="help">
          최신 100건을 표시합니다. 모든 기록은 기록 모아보기나 기간 CSV에서 확인할 수 있어요.
        </p>
      )}
    </section>
  );
}
