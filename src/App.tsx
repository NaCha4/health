import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  GoogleAuthProvider,
  signOut,
  type User,
} from 'firebase/auth';
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  ChartNoAxesCombined,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  Download,
  Dumbbell,
  ExternalLink,
  Flame,
  History,
  Home,
  Leaf,
  Link2,
  LoaderCircle,
  LogOut,
  Plus,
  RefreshCw,
  Scale,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  Utensils,
  X,
} from 'lucide-react';
import {
  labels,
  kinds,
  titleOf,
  type Entry,
  type EntryInput,
  type Kind,
  type Snapshot,
  type Change,
} from '../shared/schema';
import { today, addDays, datesInRange } from '../shared/dates';
import {
  calculateDay,
  summarize,
  mealEnergy,
  latest,
  representative,
  CALCULATION_VERSION,
} from '../shared/energy';
import { auth, apiBase, realApi, demoApi, inputOf, save, type Api } from './api';
import EntryEditor, { Modal, Field } from './EntryEditor';
import TrendExtras from './TrendExtras';

const empty: Snapshot = { entries: [], version: 0 };
const number = (v: number | null | undefined, digits = 0) =>
  v == null
    ? '—'
    : v.toLocaleString('ko-KR', { maximumFractionDigits: digits, minimumFractionDigits: digits });
const shortDate = (v: string) => `${Number(v.slice(5, 7))}.${Number(v.slice(8, 10))}`;
const longDate = (v: string) =>
  new Intl.DateTimeFormat('ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
    timeZone: 'Asia/Seoul',
  }).format(new Date(v + 'T12:00:00+09:00'));
const nav = [
  { id: 'today', label: '오늘', icon: Home },
  { id: 'records', label: '기록 모아보기', icon: CalendarDays },
  { id: 'trends', label: '변화 살펴보기', icon: ChartNoAxesCombined },
  { id: 'analysis', label: 'dot의 노트', icon: Sparkles },
  { id: 'settings', label: '설정', icon: Settings2 },
];
const icons: Record<Kind, typeof Scale> = {
  weight: Scale,
  meal: Utensils,
  workout: Dumbbell,
  body: Scale,
  baseline: Flame,
  checkin: CheckCheck,
  goal: Leaf,
  context: Clipboard,
  analysis: Sparkles,
  action: Check,
};
function description(e: Entry) {
  if (e.kind === 'meal') {
    const n = mealEnergy(e.items);
    return `${n.value == null ? '열량 미상' : number(n.value) + ' kcal'}${n.estimated ? ' · 추정 포함' : ''}${n.unknown ? ' · 정보 확인 필요' : ''}`;
  }
  if (e.kind === 'workout')
    return `${e.minutes == null ? '시간 미기록' : e.minutes + '분'} · ${e.status === 'planned' ? '계획' : '완료'}`;
  if (e.kind === 'weight') return e.fasting ? '공복 측정' : '몸무게 측정';
  if (e.kind === 'checkin')
    return `식사 ${e.mealsComplete ? '완료' : '미완료'} · 활동 ${e.activityComplete ? '완료' : '미완료'}`;
  if (e.kind === 'action')
    return { proposed: '검토할 제안', accepted: '실천 중', deferred: '나중에', done: '완료' }[
      e.status
    ];
  return labels[e.kind];
}
function stale(report: Extract<Entry, { kind: 'analysis' }>, s: Snapshot) {
  return s.entries.some(
    (e) =>
      !['analysis', 'action'].includes(e.kind) &&
      (e.dataVersion != null
        ? e.dataVersion > report.basedOnVersion
        : e.updatedAt > report.createdAt) &&
      e.date <= report.to &&
      (e.date >= report.from || ['body', 'baseline', 'weight'].includes(e.kind)),
  );
}
function WeightChart({
  snapshot,
  from,
  to,
  compact = false,
}: {
  snapshot: Snapshot;
  from: string;
  to: string;
  compact?: boolean;
}) {
  const dates = datesInRange(from, to),
    values = dates
      .map((d, i) => ({ i, v: representative(snapshot.entries, d)?.kg }))
      .filter((p): p is { i: number; v: number } => p.v != null);
  if (!values.length)
    return <div className="chart-empty">체중을 기록하면 변화가 여기에 그려져요.</div>;
  const min = Math.min(...values.map((p) => p.v)) - 0.4,
    max = Math.max(...values.map((p) => p.v)) + 0.4,
    w = 560,
    h = compact ? 110 : 210,
    left = compact ? 4 : 40,
    right = 14,
    top = 15,
    bottom = compact ? 10 : 34;
  const x = (i: number) => left + (i / Math.max(1, dates.length - 1)) * (w - left - right),
    y = (v: number) => top + ((max - v) / (max - min)) * (h - top - bottom);
  const path = values.map((p, i) => (i ? 'L' : 'M') + x(p.i) + ',' + y(p.v)).join(' ');
  return (
    <svg
      className={compact ? 'weight-chart compact' : 'weight-chart'}
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={`${shortDate(from)}부터 ${shortDate(to)}까지 ${values.length}일의 체중 측정값. 최근 ${values.at(-1)!.v} kg`}
    >
      {!compact &&
        [0, 0.5, 1].map((t) => (
          <g key={t}>
            <line
              x1={left}
              x2={w - right}
              y1={top + t * (h - top - bottom)}
              y2={top + t * (h - top - bottom)}
              stroke="currentColor"
              opacity=".1"
            />
            <text x="0" y={top + t * (h - top - bottom) + 4}>
              {number(max - t * (max - min), 1)}
            </text>
          </g>
        ))}
      {values.length > 1 && (
        <path
          d={`${path} L${x(values.at(-1)!.i)},${h - bottom} L${x(values[0].i)},${h - bottom}Z`}
          fill="currentColor"
          opacity=".055"
        />
      )}
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth={compact ? 2 : 2.4}
        strokeLinejoin="round"
      />
      {values.map((p) => (
        <circle key={p.i} cx={x(p.i)} cy={y(p.v)} r={compact ? 2 : 3.5} fill="currentColor" />
      ))}
      {!compact &&
        [0, Math.floor((dates.length - 1) / 2), dates.length - 1].map((i) => (
          <text
            key={i}
            x={x(i)}
            y={h - 5}
            textAnchor={i === 0 ? 'start' : i === dates.length - 1 ? 'end' : 'middle'}
          >
            {shortDate(dates[i])}
          </text>
        ))}
    </svg>
  );
}
function EntryRow({ entry, onClick }: { entry: Entry; onClick: () => void }) {
  const Icon = icons[entry.kind];
  return (
    <button className="entry-row" onClick={onClick}>
      <span className={'entry-icon ' + entry.kind}>
        <Icon size={19} />
      </span>
      <span className="entry-text">
        <strong>{titleOf(entry)}</strong>
        <small>{description(entry)}</small>
      </span>
      <span className="entry-origin">{entry.actor === 'dot' ? 'dot' : ''}</span>
      <ChevronRight size={16} />
    </button>
  );
}
function Logo() {
  return (
    <span className="logo">
      <span className="logo-mark">
        <Leaf size={23} strokeWidth={1.7} />
      </span>
      하루결<span className="logo-dot">.</span>
    </span>
  );
}
function download(data: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function csvCell(v: unknown) {
  const s = String(v ?? '');
  return '"' + (/^[=+\-@\t\r]/.test(s) ? "'" + s : s).replaceAll('"', '""') + '"';
}

export default function App() {
  const [user, setUser] = useState<User | null>(null),
    [authReady, setAuthReady] = useState(!auth),
    [demo, setDemo] = useState(false),
    [route, setRoute] = useState(
      () => location.hash.slice(1).split('?')[0].replace('/', '') || 'today',
    );
  const [snapshot, setSnapshot] = useState<Snapshot>(empty),
    [loading, setLoading] = useState(false),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState(''),
    [toast, setToast] = useState('');
  const [date, setDate] = useState(today()),
    [editor, setEditor] = useState<{ kind: Kind; entry?: Entry } | null>(null),
    [detail, setDetail] = useState<string | null>(null),
    [choose, setChoose] = useState(false);
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [loginBusy, setLoginBusy] = useState(false),
    [loginError, setLoginError] = useState('');
  const [kindFilter, setKindFilter] = useState('all'),
    [search, setSearch] = useState(''),
    [showTrash, setShowTrash] = useState(false),
    [month, setMonth] = useState(today().slice(0, 7)),
    [selectedDate, setSelectedDate] = useState('');
  const [range, setRange] = useState({ from: addDays(today(), -29), to: today() }),
    [recordPage, setRecordPage] = useState(1),
    [purge, setPurge] = useState<Entry | null>(null),
    [purgeText, setPurgeText] = useState('');
  const [history, setHistory] = useState<Change[]>([]),
    [historyError, setHistoryError] = useState(''),
    [connections, setConnections] = useState<Array<{ scopes: string[]; expires: number }>>([]),
    [importData, setImportData] = useState<any>(null),
    [working, setWorking] = useState(false);
  const [consent, setConsent] = useState<{ clientId: string; scopes: string[] } | null>(null);
  const api = useMemo(() => (demo ? demoApi() : user ? realApi(user) : null), [demo, user]);
  const apiRef = useRef(api);
  apiRef.current = api;
  const previousToday = useRef(today());
  useEffect(() => {
    const timer = setInterval(() => {
      const current = today();
      if (current !== previousToday.current) {
        const old = previousToday.current;
        previousToday.current = current;
        setDate((d) => (d === old ? current : d));
      }
    }, 30000);
    return () => clearInterval(timer);
  }, []);
  const navigate = (id: string) => {
    location.hash = '/' + id;
  };
  useEffect(() => {
    const change = () => {
      setRoute(location.hash.slice(1).split('?')[0].replace('/', '') || 'today');
      setDetail(null);
    };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  useEffect(
    () =>
      auth
        ? onAuthStateChanged(auth, (u) => {
            setUser(u);
            setAuthReady(true);
          })
        : undefined,
    [],
  );
  const refresh = useCallback(async () => {
    if (!api) return;
    try {
      const s = await api.get<Snapshot>('/snapshot');
      if (apiRef.current !== api) return;
      setSnapshot(s);
      setLoaded(true);
      setError('');
    } catch (e) {
      if (apiRef.current === api) setError((e as Error).message);
    } finally {
      if (apiRef.current === api) setLoading(false);
    }
  }, [api]);
  useEffect(() => {
    setSnapshot(empty);
    setLoaded(false);
    if (!api) return;
    setLoading(true);
    void refresh();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 45000);
    const visible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [api, refresh]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 4500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (!detail || !api) return;
    setHistory([]);
    setHistoryError('');
    let active = true;
    api
      .get<Change[]>('/history?id=' + encodeURIComponent(detail))
      .then((v) => {
        if (active) setHistory(v);
      })
      .catch((e) => {
        if (active) setHistoryError(e.message);
      });
    return () => {
      active = false;
    };
  }, [detail, api, snapshot.version]);
  useEffect(() => {
    if (!api || route !== 'settings') return;
    api
      .get<typeof connections>('/connections')
      .then(setConnections)
      .catch((e) => setError(e.message));
  }, [api, route]);
  const request = new URLSearchParams(location.hash.split('?')[1]).get('request');
  useEffect(() => {
    if (!api || route !== 'connect' || !request || demo) return;
    api
      .get<typeof consent>('/oauth/request?id=' + encodeURIComponent(request))
      .then(setConsent)
      .catch((e) => setError(e.message));
  }, [api, route, request, demo]);
  useEffect(() => {
    setRecordPage(1);
  }, [search, kindFilter, month, showTrash, selectedDate]);
  const notify = (message: string) => setToast(message);
  const run = async (fn: () => Promise<unknown>, message: string) => {
    setWorking(true);
    setError('');
    try {
      await fn();
      await refresh();
      notify(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  };
  const saved = async () => {
    await refresh();
    notify('기록을 저장했어요.');
  };
  const login = async (google: boolean) => {
    if (!auth) {
      setLoginError('Firebase 웹 설정이 필요합니다.');
      return;
    }
    setLoginBusy(true);
    setLoginError('');
    try {
      if (google) await signInWithPopup(auth, new GoogleAuthProvider());
      else await signInWithEmailAndPassword(auth, email, password);
      setPassword('');
      setDemo(false);
    } catch (e) {
      const code = (e as { code?: string }).code;
      setLoginError(
        code === 'auth/popup-closed-by-user'
          ? '로그인 창이 닫혔어요. 다시 시도할 수 있습니다.'
          : code === 'auth/unauthorized-domain'
            ? 'Firebase Authentication에 이 웹사이트 도메인을 등록해야 합니다.'
            : '로그인하지 못했습니다. 계정 정보와 활성화된 로그인 방식을 확인하세요.',
      );
    } finally {
      setLoginBusy(false);
    }
  };
  const logout = async () => {
    setDemo(false);
    if (auth && user) await signOut(auth);
    setSnapshot(empty);
    setDetail(null);
    setEditor(null);
    setError('');
  };
  const add = (kind: Kind) => {
    setEditor({ kind });
    setChoose(false);
  };
  const active = snapshot.entries.filter((e) => !e.deletedAt),
    day = calculateDay(snapshot, date),
    recent = calculateDay(snapshot, today()),
    week = summarize(snapshot, addDays(date, -6), date),
    prevWeek = summarize(snapshot, addDays(date, -13), addDays(date, -7));
  const goal = latest(active, 'goal', today()),
    dayEntries = active
      .filter((e) => e.date === date && ['weight', 'meal', 'workout', 'checkin'].includes(e.kind))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const selected = detail ? snapshot.entries.find((e) => e.id === detail) : undefined;
  const monthly = snapshot.entries.filter(
    (e) => !!e.deletedAt === showTrash && e.date.startsWith(month),
  );
  const filtered = monthly
    .filter(
      (e) =>
        (!selectedDate || e.date === selectedDate) &&
        (kindFilter === 'all' || e.kind === kindFilter) &&
        (!search || JSON.stringify(e).toLowerCase().includes(search.toLowerCase())),
    )
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const validRange =
    range.from <= range.to &&
    range.from &&
    range.to &&
    (+new Date(range.to) - +new Date(range.from)) / 86400000 <= 365;
  const trend = validRange ? summarize(snapshot, range.from, range.to) : null;
  const toggleArchive = async (e: Entry, restore = false) => {
    await run(
      () =>
        api!.send('/entries/' + e.id + (restore ? '/restore' : '/delete'), {
          requestId: crypto.randomUUID(),
          expectedVersion: e.version,
        }),
      restore
        ? '기록을 복원했어요.'
        : '휴지통으로 이동했어요. 설정 없이 기록 화면에서 복원할 수 있어요.',
    );
    setDetail(null);
  };
  const copyPrompt = async () => {
    const text = `내 하루결 건강 기록을 get_health_context와 get_health_summary로 조회해 ${range.from}부터 ${range.to}까지 분석해 줘. calculate_energy_balance로 필요한 날짜의 수치를 다시 계산하고, 누락과 추정 한계를 알려줘. 원본 ID와 현재 데이터 버전에 근거한 분석을 save_analysis_report로 저장해 줘. 목표나 처방은 자동 변경하지 마.`;
    try {
      await navigator.clipboard.writeText(text);
      notify('dot에게 보낼 문구를 복사했어요.');
    } catch {
      setError('클립보드를 사용할 수 없습니다. 브라우저 권한을 확인하세요.');
    }
  };
  const exportJson = () =>
    run(async () => {
      const data = await api!.get('/export');
      download(JSON.stringify(data, null, 2), 'harugyeol-' + today() + '.json', 'application/json');
    }, 'JSON 백업을 내려받았어요.');
  const exportCsv = (kind: Kind) => {
    const rows = active.filter((e) => e.kind === kind);
    const data = [
      ['날짜', '종류', '제목', 'kg', '분', 'kcal', '메모', 'ID'],
      ...rows.map((e) => [
        e.date,
        labels[e.kind],
        titleOf(e),
        e.kind === 'weight' ? e.kg : '',
        e.kind === 'workout' ? e.minutes : '',
        e.kind === 'meal' ? mealEnergy(e.items).value : '',
        e.note,
        e.id,
      ]),
    ];
    download(
      '\ufeff' + data.map((r) => r.map(csvCell).join(',')).join('\r\n'),
      'harugyeol-' + kind + '-' + today() + '.csv',
      'text/csv;charset=utf-8',
    );
    notify('CSV를 내려받았어요.');
  };

  if (!authReady)
    return (
      <div className="initial-loading">
        <LoaderCircle className="spin" /> 로그인 상태를 확인하고 있어요.
      </div>
    );
  if (!api)
    return (
      <main className="login-page">
        <div className="login-story">
          <Logo />
          <div className="login-copy">
            <span className="eyebrow">A LITTLE RECORD, A BETTER DAY</span>
            <h1>
              가볍게 기록하고,
              <br />
              나의 결을 알아가요.
            </h1>
            <p>
              몸무게부터 한 끼의 식사까지.
              <br />
              하루의 작은 기록을 dot와 함께 살펴보세요.
            </p>
            <div className="login-graphic" aria-hidden="true">
              <div className="orbit one" />
              <div className="orbit two" />
              <div className="orbit three" />
              <Leaf size={64} strokeWidth={1} />
              <span className="graphic-label">매일 조금씩, 나의 속도로</span>
            </div>
          </div>
          <span className="login-bottom">YOUR DAY, IN BALANCE.</span>
        </div>
        <div className="login-panel">
          <div className="login-form">
            <span className="eyebrow">WELCOME TO 하루결</span>
            <h2>{route === 'connect' ? 'dot와 기록 연결하기' : '나를 돌보는 기록의 시작'}</h2>
            <p>
              {route === 'connect'
                ? '소유자 계정으로 로그인한 뒤 연결 권한을 확인해 주세요.'
                : '로그인하면 내 기록을 안전하게 이어갈 수 있어요.'}
            </p>
            {import.meta.env.VITE_GOOGLE_SIGN_IN_ENABLED === 'true' && (
              <>
                <button
                  className="button google full"
                  disabled={loginBusy || !auth}
                  onClick={() => login(true)}
                >
                  <span className="google-letter">G</span>Google로 로그인
                </button>
                <div className="divider">
                  <span>또는 이메일로</span>
                </div>
              </>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void login(false);
              }}
            >
              <Field label="이메일">
                <input
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
              <Field label="비밀번호">
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
              <button className="button primary full" disabled={loginBusy || !auth}>
                {loginBusy ? '로그인 중…' : '로그인'}
                <ArrowRight size={17} />
              </button>
            </form>
            <button
              className="demo-button"
              disabled={loginBusy || !auth}
              onClick={async () => {
                if (!email.trim() || !email.includes('@')) {
                  setLoginError('위에 소유자 이메일을 입력해 주세요.');
                  return;
                }
                setLoginBusy(true);
                setLoginError('');
                try {
                  await sendPasswordResetEmail(auth!, email.trim(), {
                    url: window.location.origin + window.location.pathname,
                  });
                  setLoginError(
                    '등록된 이메일이면 비밀번호 설정 메일을 보냈어요. 받은편지함과 스팸함을 확인해 주세요.',
                  );
                } catch {
                  setLoginError(
                    '메일 요청을 처리하지 못했습니다. 이메일을 확인하고 잠시 후 다시 시도해 주세요.',
                  );
                } finally {
                  setLoginBusy(false);
                }
              }}
            >
              처음 이용하거나 비밀번호를 잊으셨나요?
            </button>
            {loginError && (
              <p className="error" role="alert">
                {loginError}
              </p>
            )}
            {(!apiBase || !auth) && (
              <p className="setup-note">
                <Settings2 size={16} />{' '}
                {auth
                  ? 'Firebase 설정은 준비되어 있어요. 서버 배포 후 API 주소를 연결해 주세요.'
                  : 'Firebase 연결 설정이 필요해요.'}
              </p>
            )}
            <button
              className="demo-button"
              onClick={() => {
                setDemo(true);
                navigate('today');
              }}
            >
              먼저 가상 기록으로 둘러보기 <ArrowRight size={16} />
            </button>
            <p className="privacy">
              <ShieldCheck size={15} /> 허용된 소유자 계정만 기록에 접근합니다.
            </p>
          </div>
        </div>
      </main>
    );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a href="#/today" aria-label="하루결 홈">
          <Logo />
        </a>
        <p className="sidebar-caption">나를 알아가는 작은 기록</p>
        <nav>
          {nav.map((n) => (
            <a
              href={'#/' + n.id}
              key={n.id}
              className={route === n.id ? 'active' : ''}
              aria-current={route === n.id ? 'page' : undefined}
            >
              <n.icon size={20} />
              <span>{n.label}</span>
              {n.id === 'analysis' && <span className="nav-dot" />}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="dot-status">
            <span className="status-dot" />
            <div>
              <strong>{demo ? '가상 기록 체험 중' : '나의 건강 기록'}</strong>
              <small>{demo ? '새로고침하면 초기화돼요' : 'dot와 같은 기록을 사용해요'}</small>
            </div>
          </div>
          <button className="account" onClick={logout}>
            <span className="avatar">{demo ? '체' : user?.displayName?.slice(0, 1) || '나'}</span>
            <span>
              {demo ? '체험 마치기' : user?.displayName || '로그인한 계정'}
              <small>{demo ? '실제 데이터는 바뀌지 않아요' : '로그아웃'}</small>
            </span>
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb">
            <Leaf size={15} />
            <span>나의 건강 기록</span>
            <ChevronRight size={13} />
            <strong>{nav.find((n) => n.id === route)?.label ?? 'dot 연결'}</strong>
          </div>
          <div className="topbar-right">
            <button
              className="icon-button mobile-settings"
              aria-label="설정 열기"
              onClick={() => navigate('settings')}
            >
              <Settings2 size={18} />
            </button>
            <span className={'mode-badge ' + (demo ? 'demo' : '')}>
              <span />
              {demo ? '가상 데이터' : loaded ? '동기화됨' : '연결 확인 중'}
            </span>
            <button
              className="icon-button"
              aria-label="새로고침"
              onClick={() => {
                setLoading(true);
                void refresh();
              }}
            >
              <RefreshCw size={17} className={loading ? 'spin' : ''} />
            </button>
          </div>
        </header>
        <div className="page-content">
          {error && (
            <div className="error global-error" role="alert">
              <span>{error}</span>
              <button
                className="icon-button"
                aria-label="오류 알림 닫기"
                onClick={() => setError('')}
              >
                <X size={17} />
              </button>
            </div>
          )}
          {demo && (
            <div className="demo-strip">
              이 화면은 기능을 살펴보는 가상 기록입니다. 실제 신체정보나 분석이 아닙니다.
            </div>
          )}
          {route === 'today' && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">MY DAILY BALANCE</span>
                  <h1>
                    오늘도, 나의 속도로<span className="heading-dot">.</span>
                  </h1>
                  <p>완벽한 하루보다, 꾸준히 알아가는 나.</p>
                </div>
                <button
                  className="button primary"
                  onClick={() => setChoose(true)}
                  disabled={!loaded}
                >
                  <Plus size={18} />
                  기록하기
                </button>
              </div>
              <div className="date-switch">
                <button
                  className="icon-button"
                  aria-label="이전 날짜"
                  onClick={() => setDate(addDays(date, -1))}
                >
                  <ChevronLeft size={18} />
                </button>
                <Field label="살펴볼 날짜">
                  <input
                    aria-label="살펴볼 날짜"
                    type="date"
                    value={date}
                    onChange={(e) => {
                      if (e.target.value) setDate(e.target.value);
                    }}
                  />
                </Field>
                <button
                  className="icon-button"
                  aria-label="다음 날짜"
                  onClick={() => setDate(addDays(date, 1))}
                >
                  <ChevronRight size={18} />
                </button>
                <span>{longDate(date)}</span>
                {date !== today() && (
                  <button className="text-button" onClick={() => setDate(today())}>
                    오늘로
                  </button>
                )}
              </div>
              <div className="overview-grid">
                <section className="weight-hero">
                  <div className="hero-top">
                    <span>
                      <Scale size={18} /> 나의 몸무게
                    </span>
                    <span className="hero-tag">
                      {day.weight ? shortDate(day.weight.date) + ' 측정' : '기록을 기다려요'}
                    </span>
                  </div>
                  <div className="hero-number">
                    {number(day.weight?.kg, 1)} <span>kg</span>
                  </div>
                  <div className="hero-comparison">
                    {week.weightAverage != null && prevWeek.weightAverage != null ? (
                      <>
                        <ArrowDownLeft size={16} />
                        <strong>
                          이전 7일보다 {number(week.weightAverage - prevWeek.weightAverage, 1)} kg
                        </strong>
                        <span>평균 기준</span>
                      </>
                    ) : (
                      <span>한 번의 숫자보다 차곡차곡 쌓이는 흐름을 봐요.</span>
                    )}
                  </div>
                  <WeightChart snapshot={snapshot} from={addDays(date, -13)} to={date} compact />
                  <div className="hero-footer">
                    <span>
                      최근 7일 평균 <strong>{number(week.weightAverage, 1)} kg</strong>
                    </span>
                    <span>{week.weightDays}일 측정 기준</span>
                  </div>
                </section>
                <section className="card energy-card">
                  <div className="section-line">
                    <h2>
                      <Flame size={19} /> 하루의 에너지
                    </h2>
                    <span className="tag">예상치</span>
                  </div>
                  <div className="energy-main">
                    <div>
                      <span className="muted">기록한 섭취량</span>
                      <strong>
                        {number(day.intake.value)}
                        <small> kcal</small>
                      </strong>
                    </div>
                    <span className="energy-slash">/</span>
                    <div>
                      <span className="muted">하루 예상 소비</span>
                      <strong>
                        {number(day.totalExpenditure)}
                        <small> kcal</small>
                      </strong>
                    </div>
                  </div>
                  <div className="energy-track">
                    <span
                      style={{
                        width:
                          day.totalExpenditure && day.intake.value != null
                            ? Math.min(100, (day.intake.value / day.totalExpenditure) * 100) + '%'
                            : '0%',
                      }}
                    />
                  </div>
                  <div className="energy-breakdown">
                    <span>
                      <i className="green" />
                      안정 시 대사량<strong>{number(day.ree)} kcal</strong>
                    </span>
                    <span>
                      <i className="light-green" />
                      추가 운동 소비<strong>{number(day.additionalExercise)} kcal</strong>
                    </span>
                  </div>
                  <p className="card-note">
                    {day.balance
                      ? `기록 완료일의 예상 차이 ${number(day.balance.value)} kcal · 소비 − 섭취`
                      : day.missing.length
                        ? `계산에 필요한 정보: ${day.missing.join(', ')}`
                        : '섭취는 현재 기록 기준, 소비는 하루 전체 예상치예요.'}
                  </p>
                  <button
                    className="text-button"
                    onClick={() => {
                      navigate('trends');
                      setRange({ from: date, to: date });
                    }}
                  >
                    계산 근거 살펴보기 <ArrowRight size={14} />
                  </button>
                </section>
              </div>
              <div className="quick-actions">
                {(
                  [
                    { kind: 'weight', icon: Scale, title: '몸무게', text: '오늘의 숫자 남기기' },
                    { kind: 'meal', icon: Utensils, title: '식사', text: '한 끼를 가볍게 기록' },
                    { kind: 'workout', icon: Dumbbell, title: '운동', text: '움직인 만큼 쌓이게' },
                  ] as const
                ).map((q) => (
                  <button disabled={!loaded} key={q.kind} onClick={() => add(q.kind)}>
                    <span className={'quick-icon ' + q.kind}>
                      <q.icon size={21} />
                    </span>
                    <span>
                      <strong>{q.title} 기록</strong>
                      <small>{q.text}</small>
                    </span>
                    <Plus size={18} />
                  </button>
                ))}
              </div>
              <div className="daily-grid">
                <section className="card daily-records">
                  <div className="section-line">
                    <h2>
                      하루에 남긴 기록 <span className="count">{dayEntries.length}</span>
                    </h2>
                    <button
                      className="text-button"
                      onClick={() => {
                        setMonth(date.slice(0, 7));
                        setSelectedDate(date);
                        navigate('records');
                      }}
                    >
                      모두 보기
                      <ArrowRight size={14} />
                    </button>
                  </div>
                  {dayEntries.length ? (
                    dayEntries.map((e) => (
                      <EntryRow entry={e} key={e.id} onClick={() => setDetail(e.id)} />
                    ))
                  ) : (
                    <div className="empty-state">
                      <Leaf size={30} />
                      <h3>작은 기록 하나면 충분해요.</h3>
                      <p>몸무게, 한 끼, 짧은 산책부터 남겨보세요.</p>
                    </div>
                  )}
                </section>
                <div className="daily-aside">
                  <section className="card checkin-card">
                    <span className="eyebrow">A MOMENT FOR YOURSELF</span>
                    <h2>하루를 돌아볼까요?</h2>
                    <p>빠진 기록이 있는지 천천히 살펴보세요.</p>
                    <div className="completion-row">
                      <span>식사 기록</span>
                      <span className={day.mealsComplete ? 'complete' : ''}>
                        {day.mealsComplete ? (
                          <>
                            <Check size={14} />
                            완료
                          </>
                        ) : (
                          '기록 중'
                        )}
                      </span>
                    </div>
                    <div className="completion-row">
                      <span>활동 기록</span>
                      <span className={day.activityComplete ? 'complete' : ''}>
                        {day.activityComplete ? (
                          <>
                            <Check size={14} />
                            완료
                          </>
                        ) : (
                          '기록 중'
                        )}
                      </span>
                    </div>
                    <button
                      className="button secondary full"
                      disabled={!loaded}
                      onClick={() => {
                        const entry = latest(active, 'checkin', date);
                        setEditor({
                          kind: 'checkin',
                          entry: entry?.date === date ? entry : undefined,
                        });
                      }}
                    >
                      하루 점검하기
                      <ArrowRight size={16} />
                    </button>
                  </section>
                  <section className="goal-note">
                    <Leaf size={19} />
                    <div>
                      <small>지금의 작은 목표</small>
                      <strong>{goal?.title ?? '나에게 맞는 목표를 정해봐요'}</strong>
                      <button
                        className="text-button"
                        onClick={() => setEditor({ kind: 'goal', entry: goal })}
                      >
                        {goal ? '목표 살펴보기' : '목표 기록하기'}
                        <ArrowRight size={13} />
                      </button>
                    </div>
                  </section>
                </div>
              </div>
            </>
          )}

          {route === 'records' && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">YOUR DAILY JOURNAL</span>
                  <h1>하루하루의 기록</h1>
                  <p>남겨둔 순간을 다시 보고, 필요한 만큼 고쳐요.</p>
                </div>
                <button
                  className="button primary"
                  disabled={!loaded}
                  onClick={() => setChoose(true)}
                >
                  <Plus size={18} />
                  기록하기
                </button>
              </div>
              <section className="card calendar-card">
                <div className="section-line">
                  <h2>
                    <CalendarDays size={20} /> 기록 달력
                  </h2>
                  <input
                    aria-label="기록 월"
                    type="month"
                    value={month}
                    onChange={(e) => {
                      if (e.target.value) {
                        setMonth(e.target.value);
                        setSelectedDate('');
                      }
                    }}
                  />
                </div>
                <div className="calendar-week">
                  {'일월화수목금토'.split('').map((d) => (
                    <span key={d}>{d}</span>
                  ))}
                </div>
                <div className="calendar-grid">
                  {Array.from({ length: new Date(month + '-01T12:00:00').getDay() }, (_, i) => (
                    <span key={'blank' + i} />
                  ))}
                  {Array.from(
                    {
                      length: new Date(
                        Number(month.slice(0, 4)),
                        Number(month.slice(5)),
                        0,
                      ).getDate(),
                    },
                    (_, i) => {
                      const d = month + '-' + String(i + 1).padStart(2, '0'),
                        entries = monthly.filter((e) => e.date === d);
                      return (
                        <button
                          key={d}
                          aria-label={`${d} 기록 ${entries.length}개`}
                          aria-pressed={selectedDate === d}
                          className={
                            (selectedDate === d ? 'selected ' : '') +
                            (d === today() ? 'is-today' : '')
                          }
                          onClick={() => {
                            setSelectedDate(selectedDate === d ? '' : d);
                            setDate(d);
                          }}
                        >
                          <span>{i + 1}</span>
                          <span className="calendar-dots">
                            {(['weight', 'meal', 'workout'] as Kind[]).map((k) =>
                              entries.some((e) => e.kind === k) ? (
                                <i key={k} className={k} />
                              ) : null,
                            )}
                            {entries.length > 0 &&
                              !entries.some((e) =>
                                ['weight', 'meal', 'workout'].includes(e.kind),
                              ) && <i />}
                          </span>
                        </button>
                      );
                    },
                  )}
                </div>
                <div className="calendar-legend">
                  <span>
                    <i className="weight" />
                    체중
                  </span>
                  <span>
                    <i className="meal" />
                    식사
                  </span>
                  <span>
                    <i className="workout" />
                    운동
                  </span>
                </div>
              </section>
              <div className="record-toolbar">
                <div className="search-input">
                  <Search size={18} />
                  <input
                    aria-label="기록 검색"
                    placeholder="음식, 운동, 메모 검색"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <select
                  aria-label="기록 종류"
                  value={kindFilter}
                  onChange={(e) => setKindFilter(e.target.value)}
                >
                  <option value="all">모든 기록</option>
                  {kinds.map((k) => (
                    <option key={k} value={k}>
                      {labels[k]}
                    </option>
                  ))}
                </select>
                <button
                  className={'button ' + (showTrash ? 'primary' : 'secondary')}
                  onClick={() => setShowTrash(!showTrash)}
                >
                  <Trash2 size={16} />
                  {showTrash ? '휴지통 보는 중' : '휴지통'}
                </button>
              </div>
              <div className="section-line record-count">
                <span>
                  {selectedDate ? longDate(selectedDate) : month.replace('-', '년 ') + '월'} ·{' '}
                  {filtered.length}개의 기록
                </span>
                {selectedDate && (
                  <button className="text-button" onClick={() => setSelectedDate('')}>
                    월 전체 보기
                  </button>
                )}
              </div>
              <section className="card record-list">
                {filtered.slice(0, recordPage * 30).map((e, i, arr) => (
                  <div key={e.id}>
                    {(i === 0 || arr[i - 1].date !== e.date) && (
                      <h3 className="record-date">{longDate(e.date)}</h3>
                    )}
                    <EntryRow entry={e} onClick={() => setDetail(e.id)} />
                  </div>
                ))}
                {!filtered.length && (
                  <div className="empty-state">
                    <CalendarDays size={32} />
                    <h3>이곳에는 아직 기록이 없어요.</h3>
                    <p>날짜나 검색 조건을 바꿔서 살펴보세요.</p>
                  </div>
                )}
                {filtered.length > recordPage * 30 && (
                  <button
                    className="button secondary full"
                    onClick={() => setRecordPage((p) => p + 1)}
                  >
                    다음 기록 보기
                  </button>
                )}
              </section>
            </>
          )}

          {route === 'trends' && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">SEE THE BIGGER PICTURE</span>
                  <h1>숫자 너머의 변화</h1>
                  <p>하루보다 조금 더 긴 흐름으로 나를 알아가요.</p>
                </div>
              </div>
              <div className="range-toolbar">
                <Field label="시작일">
                  <input
                    type="date"
                    value={range.from}
                    onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
                  />
                </Field>
                <span>—</span>
                <Field label="종료일">
                  <input
                    type="date"
                    value={range.to}
                    onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
                  />
                </Field>
                {[7, 30, 90].map((n) => (
                  <button
                    key={n}
                    className="button secondary"
                    onClick={() => setRange({ from: addDays(today(), 1 - n), to: today() })}
                  >
                    {n + '일'}
                  </button>
                ))}
              </div>
              {!trend ? (
                <p className="error">
                  시작일과 종료일을 확인해 주세요. 한 번에 최대 366일을 볼 수 있어요.
                </p>
              ) : (
                <>
                  <div className="metric-grid">
                    <section className="card">
                      <span>평균 체중</span>
                      <strong>
                        {number(trend.weightAverage, 1)}
                        <small> kg</small>
                      </strong>
                      <p>{trend.weightDays}일 측정 기준</p>
                    </section>
                    <section className="card">
                      <span>기록한 운동</span>
                      <strong>
                        {number(trend.workoutMinutes)}
                        <small> 분</small>
                      </strong>
                      <p>{trend.workoutDays}일의 완료한 운동</p>
                    </section>
                    <section className="card">
                      <span>하루 평균 섭취</span>
                      <strong>
                        {number(trend.intakeAverage)}
                        <small> kcal</small>
                      </strong>
                      <p>
                        완료 {trend.completeMealDays}일 · 제외 {trend.excludedMealDays}일
                      </p>
                    </section>
                  </div>
                  <section className="card trend-card">
                    <div className="section-line">
                      <h2>몸무게의 흐름</h2>
                      <span className="muted">kg · 날짜별 대표 측정값</span>
                    </div>
                    <WeightChart snapshot={snapshot} from={range.from} to={range.to} />
                    <p className="help">
                      점은 실제 측정일입니다. 측정하지 않은 날은 평균에서 제외해요.
                    </p>
                  </section>
                  <TrendExtras snapshot={snapshot} from={range.from} to={range.to} />
                  <section className="card table-card">
                    <div className="section-line">
                      <h2>기록과 에너지 계산</h2>
                      <span className="tag">조회 시 다시 계산</span>
                    </div>
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>날짜</th>
                            <th>체중</th>
                            <th>섭취</th>
                            <th>예상 소비</th>
                            <th>예상 차이¹</th>
                            <th>완료 상태</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...trend.days].reverse().map((d) => (
                            <tr key={d.date}>
                              <th>
                                <button
                                  className="text-button"
                                  onClick={() => {
                                    setDate(d.date);
                                    setRange({ from: d.date, to: d.date });
                                  }}
                                >
                                  {shortDate(d.date)}
                                </button>
                              </th>
                              <td>{number(representative(snapshot.entries, d.date)?.kg, 1)}</td>
                              <td>
                                {number(d.intake.value)}
                                {d.intake.estimated ? ' ≈' : ''}
                              </td>
                              <td>{number(d.totalExpenditure)}</td>
                              <td>{number(d.balance?.value)}</td>
                              <td>
                                <span
                                  className={
                                    d.mealsComplete && d.activityComplete ? 'complete' : 'muted'
                                  }
                                >
                                  {d.mealsComplete ? '식사 ✓' : '식사 ·'}{' '}
                                  {d.activityComplete ? '활동 ✓' : '활동 ·'}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="help">
                      ¹ 소비 − 섭취 (kcal). 지난 날짜이며 식사·활동 기록이 완료된 경우에만 표시해요.
                      ≈는 추정 포함, —는 미상입니다.
                    </p>
                  </section>
                  <section className="card calculation-card">
                    <div className="section-line">
                      <h2>{shortDate(trend.days.at(-1)!.date)} 계산 근거</h2>
                      <span className="tag">{CALCULATION_VERSION}</span>
                    </div>
                    {(() => {
                      const d = trend.days.at(-1)!;
                      return (
                        <>
                          <div className="formula-row">
                            <span>안정 시 대사량</span>
                            <strong>{number(d.ree)} kcal</strong>
                            <small>Mifflin–St Jeor · 추정</small>
                          </div>
                          <div className="formula-row">
                            <span>생활 활동 기준선</span>
                            <strong>{number(d.baselineKcal)} kcal</strong>
                            <small>대사량 × 생활 활동 계수</small>
                          </div>
                          <div className="formula-row">
                            <span>추가 운동 소비</span>
                            <strong>{number(d.additionalExercise)} kcal</strong>
                            <small>
                              {d.baselineMode === 'includes_exercise'
                                ? '기준선에 포함되어 추가하지 않음'
                                : '기준선과 겹치는 소비 제외'}
                            </small>
                          </div>
                          <div className="formula-row total">
                            <span>하루 예상 총소비</span>
                            <strong>{number(d.totalExpenditure)} kcal</strong>
                            <small>실측값이 아닙니다</small>
                          </div>
                          <p className="help">
                            섭취 추정 범위 {number(d.intake.low)}–{number(d.intake.high)} kcal.
                            소비량의 개인차에 대한 신뢰구간은 포함하지 않습니다.
                          </p>
                          {d.missing.length > 0 && (
                            <p className="setup-note">필요한 정보: {d.missing.join(', ')}</p>
                          )}
                          <ul className="notes">
                            {d.warnings.map((w) => (
                              <li key={w}>{w}</li>
                            ))}
                          </ul>
                          <div className="evidence-links">
                            {d.evidenceIds.map((id) => {
                              const e = active.find((e) => e.id === id);
                              return e ? (
                                <button key={id} className="chip" onClick={() => setDetail(id)}>
                                  <Link2 size={12} />
                                  {titleOf(e)}
                                </button>
                              ) : null;
                            })}
                          </div>
                          <details>
                            <summary>운동별 계산 보기</summary>
                            {d.workouts.length ? (
                              d.workouts.map((w) => (
                                <p key={w.id} className="help">
                                  {w.name}: 총소비 {number(w.gross)} / 순운동 {number(w.net)} /
                                  기준선 대비 추가 {number(w.extra)} kcal
                                </p>
                              ))
                            ) : (
                              <p className="help">완료한 운동 기록이 없어요.</p>
                            )}
                          </details>
                        </>
                      );
                    })()}
                  </section>
                </>
              )}
            </>
          )}

          {route === 'analysis' && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">A NOTE FROM DOT</span>
                  <h1>기록을 함께 읽는 시간</h1>
                  <p>dot의 관찰과 제안을 내 속도에 맞게 살펴봐요.</p>
                </div>
                <button className="button primary" onClick={copyPrompt}>
                  <Clipboard size={17} />
                  분석 요청 문구 복사
                </button>
              </div>
              <section className="dot-intro">
                <span className="dot-orb">
                  <Sparkles size={28} />
                </span>
                <div>
                  <h2>기억은 기록에, 이해는 대화에.</h2>
                  <p>
                    dot는 필요한 기록을 읽고 계산한 뒤, 근거가 있는 노트를 남겨요.
                    <br />
                    복사한 문구를 연결된 dot에게 보내주세요.
                  </p>
                </div>
                <button className="text-button" onClick={() => navigate('settings')}>
                  연결 설정
                  <ArrowRight size={15} />
                </button>
              </section>
              <div className="analysis-grid">
                <div>
                  {active
                    .filter((e): e is Extract<Entry, { kind: 'analysis' }> => e.kind === 'analysis')
                    .sort((a, b) => b.date.localeCompare(a.date))
                    .map((e) => (
                      <article className="card report-card" key={e.id}>
                        <div className="section-line">
                          <span className="report-author">
                            <Sparkles size={16} />{' '}
                            {e.actor === 'demo'
                              ? 'dot · 가상 분석'
                              : e.actor === 'dot'
                                ? 'dot의 노트'
                                : '분석 노트'}
                          </span>
                          <span className="muted">{shortDate(e.date)}</span>
                        </div>
                        <h2>{e.title}</h2>
                        <p className="report-period">
                          {shortDate(e.from)} — {shortDate(e.to)} · 근거 {e.evidenceIds.length}개
                        </p>
                        {stale(e, snapshot) && (
                          <p className="stale-note">
                            이후 원본이 변경되었어요. 다시 검토해 주세요.
                          </p>
                        )}
                        <p className="report-text">{e.observations}</p>
                        <div className="report-suggestion">
                          <strong>다음으로 해볼 일</strong>
                          <p>{e.suggestions || '아직 제안이 없어요.'}</p>
                        </div>
                        <p className="help">{e.limitations}</p>
                        <button className="text-button" onClick={() => setDetail(e.id)}>
                          근거와 전체 기록 보기
                          <ArrowRight size={15} />
                        </button>
                      </article>
                    ))}
                  {!active.some((e) => e.kind === 'analysis') && (
                    <section className="card empty-state">
                      <Sparkles size={35} />
                      <h3>첫 번째 노트를 기다리고 있어요.</h3>
                      <p>dot를 연결하고 모인 기록의 분석을 요청해 보세요.</p>
                    </section>
                  )}
                </div>
                <section className="card actions-card">
                  <h2>작게 실천해보기</h2>
                  <p className="help">제안은 내가 선택할 때 시작됩니다.</p>
                  {active
                    .filter((e): e is Extract<Entry, { kind: 'action' }> => e.kind === 'action')
                    .map((e) => (
                      <div className="action-item" key={e.id}>
                        <span className="tag">{description(e)}</span>
                        <h3>{e.title}</h3>
                        {e.feedback && <p className="help">{e.feedback}</p>}
                        <div className="action-buttons">
                          {e.status === 'proposed' && (
                            <>
                              <button
                                className="button primary small"
                                disabled={working}
                                onClick={() =>
                                  run(
                                    () =>
                                      save(
                                        api,
                                        { ...inputOf(e), status: 'accepted' } as EntryInput,
                                        e,
                                      ),
                                    '실천 항목을 채택했어요.',
                                  )
                                }
                              >
                                해볼게요
                              </button>
                              <button
                                className="text-button"
                                disabled={working}
                                onClick={() =>
                                  run(
                                    () =>
                                      save(
                                        api,
                                        { ...inputOf(e), status: 'deferred' } as EntryInput,
                                        e,
                                      ),
                                    '나중에 다시 볼게요.',
                                  )
                                }
                              >
                                나중에
                              </button>
                            </>
                          )}
                          {e.status === 'accepted' && (
                            <button
                              className="button secondary small"
                              disabled={working}
                              onClick={() =>
                                run(
                                  () =>
                                    save(api, { ...inputOf(e), status: 'done' } as EntryInput, e),
                                  '실천을 완료했어요.',
                                )
                              }
                            >
                              <Check size={14} />
                              완료했어요
                            </button>
                          )}
                          <button
                            className="text-button"
                            onClick={() => setEditor({ kind: 'action', entry: e })}
                          >
                            메모·수정
                          </button>
                        </div>
                      </div>
                    ))}
                  {!active.some((e) => e.kind === 'action') && (
                    <p className="empty-inline">아직 제안된 실천 항목이 없어요.</p>
                  )}
                </section>
              </div>
            </>
          )}

          {route === 'settings' && (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">MADE FOR YOUR RHYTHM</span>
                  <h1>나에게 맞게 준비하기</h1>
                  <p>계산의 기준과 기록 연결을 관리해요.</p>
                </div>
              </div>
              <div className="settings-grid">
                <section className="card setting-card">
                  <div className="section-line">
                    <h2>
                      <Scale size={19} /> 신체정보와 생활 활동
                    </h2>
                  </div>
                  <p className="help">적용 날짜를 남겨 과거 기록도 당시의 정보로 계산합니다.</p>
                  {(['body', 'baseline'] as const).map((k) => {
                    const e = latest(active, k, today());
                    return (
                      <div className="setting-item" key={k}>
                        <div>
                          <strong>{labels[k]}</strong>
                          <small>
                            {e
                              ? `${shortDate(e.date)}부터 적용 · ${e.kind === 'body' ? (e.heightCm ?? '미상') + ' cm' : e.description}`
                              : '아직 입력하지 않았어요'}
                          </small>
                        </div>
                        <button
                          className="button secondary small"
                          onClick={() => setEditor({ kind: k })}
                        >
                          새 기준 기록
                        </button>
                        {e && (
                          <button
                            className="icon-button"
                            aria-label={labels[k] + ' 보기'}
                            onClick={() => setDetail(e.id)}
                          >
                            <ChevronRight size={17} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                  <p className="help">
                    미성년자, 임신·수유 등 일반 성인식이 맞지 않는 경우에는 계산 적용을 선택하지
                    마세요.
                  </p>
                </section>
                <section className="card setting-card">
                  <h2>
                    <Leaf size={19} /> 목표와 알아둘 점
                  </h2>
                  {active
                    .filter((e) => ['goal', 'context'].includes(e.kind))
                    .map((e) => (
                      <EntryRow key={e.id} entry={e} onClick={() => setDetail(e.id)} />
                    ))}
                  <div className="button-row">
                    <button className="button secondary small" onClick={() => add('goal')}>
                      <Plus size={14} />
                      목표
                    </button>
                    <button className="button secondary small" onClick={() => add('context')}>
                      <Plus size={14} />
                      선호·제약
                    </button>
                  </div>
                </section>
                <section className="card setting-card">
                  <div className="section-line">
                    <h2>
                      <Link2 size={19} /> dot 연결
                    </h2>
                    <span className="tag">{connections.length ? '연결됨' : '연결 전'}</span>
                  </div>
                  <p>ChatGPT에서 사용자 정의 MCP 연결을 추가한 뒤 이 계정으로 로그인해 주세요.</p>
                  <Field label="MCP 서버 주소">
                    <input
                      readOnly
                      value={apiBase ? apiBase + '/mcp' : '서버 배포 후 표시됩니다'}
                    />
                  </Field>
                  <p className="help">
                    연결 방식: OAuth · 공개 클라이언트 ID는 서버 설정과 같아야 해요. 연결 가능
                    여부는 ChatGPT 계정 기능에 따라 달라집니다.
                  </p>
                  {connections.map((c, i) => (
                    <p key={i} className="help">
                      {c.scopes.includes('health:write') ? '조회·기록 권한' : '조회 권한'} ·{' '}
                      {new Date(c.expires).toLocaleDateString('ko-KR')}까지
                    </p>
                  ))}
                  <button
                    className="button secondary"
                    disabled={working || !connections.length}
                    onClick={() =>
                      run(async () => {
                        await api.send('/connections', undefined, 'DELETE');
                        setConnections([]);
                      }, 'dot 연결을 해제했어요. 다시 사용하려면 연결이 필요합니다.')
                    }
                  >
                    모든 dot 연결 해제
                  </button>
                </section>
                <section className="card setting-card">
                  <h2>
                    <Download size={19} /> 내 기록 보관하기
                  </h2>
                  <p>JSON에는 원본·출처·수정 이력이 함께 담겨요.</p>
                  <div className="button-row">
                    <button className="button secondary" disabled={working} onClick={exportJson}>
                      <Download size={16} />
                      JSON 백업
                    </button>
                    {(['weight', 'meal', 'workout'] as const).map((k) => (
                      <button
                        key={k}
                        className="button secondary small"
                        onClick={() => exportCsv(k)}
                      >
                        {labels[k]} CSV
                      </button>
                    ))}
                  </div>
                  <hr />
                  <h3>백업 복원</h3>
                  <p className="help">
                    기록이 없는 계정에서 JSON 백업의 ID와 이력을 그대로 복원합니다. 중단되면 같은
                    파일로 다시 시도하세요.
                  </p>
                  <label className="button secondary upload-button">
                    <Upload size={16} />
                    JSON 파일 선택
                    <input
                      type="file"
                      accept="application/json,.json"
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        e.target.value = '';
                        if (!f) return;
                        try {
                          if (f.size > 8 * 1024 * 1024)
                            throw new Error('8 MB 이하 파일을 선택하세요.');
                          const data = JSON.parse(await f.text());
                          if (
                            data.format !== 'dot-health' ||
                            data.schemaVersion !== 1 ||
                            !Array.isArray(data.entries) ||
                            !Array.isArray(data.history)
                          )
                            throw new Error('지원하는 하루결 백업 파일이 아닙니다.');
                          setImportData(data);
                        } catch (err) {
                          setError((err as Error).message);
                        }
                      }}
                    />
                  </label>
                </section>
                <section className="card setting-card">
                  <h2>
                    <ShieldCheck size={19} /> 계정과 데이터
                  </h2>
                  <p>
                    현재 모드: {demo ? '가상 기록 체험' : '개인 기록'} · 날짜 기준: 한국
                    (Asia/Seoul)
                  </p>
                  {!demo && user && (
                    <Field label="소유자 UID">
                      <input readOnly value={user.uid} />
                    </Field>
                  )}
                  <p className="help">
                    삭제한 기록은 기록 화면의 휴지통에서 복원할 수 있습니다. 영구 삭제는 원본과 해당
                    이력, 연결된 분석·실천 항목까지 제거합니다. 내려받은 백업 파일은 별도로 관리해
                    주세요.
                  </p>
                  <button
                    className="text-button"
                    onClick={() => {
                      setShowTrash(true);
                      navigate('records');
                    }}
                  >
                    휴지통 보기
                    <ArrowRight size={14} />
                  </button>
                  <hr />
                  <button className="button secondary" onClick={logout}>
                    <LogOut size={16} />
                    {demo ? '체험 마치기' : '로그아웃'}
                  </button>
                </section>
              </div>
            </>
          )}

          {route === 'connect' && (
            <section className="card consent-card">
              <span className="dot-orb">
                <Link2 size={30} />
              </span>
              <h1>dot에 기록을 연결할까요?</h1>
              {demo ? (
                <p>체험 모드에서는 연결할 수 없습니다. 소유자 계정으로 로그인해 주세요.</p>
              ) : consent ? (
                <>
                  <p>
                    <strong>{consent.clientId}</strong>에서 다음 권한을 요청했어요.
                  </p>
                  <ul className="consent-list">
                    <li>
                      <Check size={17} />내 신체정보·식사·운동·분석 조회
                    </li>
                    {consent.scopes.includes('health:write') && (
                      <li>
                        <Check size={17} />
                        기록 생성·수정, 분석과 실천 제안 저장
                      </li>
                    )}
                  </ul>
                  <p className="help">
                    목표의 자동 변경이나 영구 삭제 권한은 포함하지 않습니다. 설정에서 언제든 연결을
                    해제할 수 있어요.
                  </p>
                  <div className="button-row">
                    {[false, true].map((allow) => (
                      <button
                        key={String(allow)}
                        className={'button ' + (allow ? 'primary' : 'secondary')}
                        disabled={working}
                        onClick={() =>
                          run(
                            async () => {
                              const r = await api.send<{ redirectUrl: string }>('/oauth/approve', {
                                id: request,
                                allow,
                              });
                              location.assign(r.redirectUrl);
                            },
                            allow ? '연결을 승인했어요.' : '연결을 취소했어요.',
                          )
                        }
                      >
                        {allow ? '허용하고 연결' : '취소'}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <p>연결 요청을 확인하고 있어요. 만료되었다면 dot에서 다시 연결해 주세요.</p>
              )}
            </section>
          )}
          {!nav.some((n) => n.id === route) && route !== 'connect' && (
            <div className="empty-state">
              <h1>페이지를 찾을 수 없어요.</h1>
              <a className="button primary" href="#/today">
                오늘로 돌아가기
              </a>
            </div>
          )}
          <footer className="page-footer">
            <span>
              하루결 <span>·</span> 매일 조금씩, 나의 속도로.
            </span>
            <span>기록 v{snapshot.version} · 한국 시간</span>
          </footer>
        </div>
      </main>
      {choose && (
        <Modal title="무엇을 기록할까요?" onClose={() => setChoose(false)}>
          <div className="modal-body record-choices">
            {kinds.map((k) => {
              const Icon = icons[k];
              return (
                <button key={k} onClick={() => add(k)}>
                  <Icon size={24} />
                  <span>{labels[k]}</span>
                  <Plus size={17} />
                </button>
              );
            })}
          </div>
        </Modal>
      )}
      {editor && (
        <EntryEditor
          api={api}
          kind={editor.kind}
          date={date}
          entry={editor.entry}
          initial={
            !editor.entry && ['body', 'baseline'].includes(editor.kind)
              ? (() => {
                  const e = latest(active, editor.kind, date);
                  return e ? inputOf(e) : undefined;
                })()
              : undefined
          }
          version={snapshot.version}
          onClose={() => setEditor(null)}
          onSaved={saved}
        />
      )}
      {selected && !editor && (
        <Modal
          title={labels[selected.kind] + ' 상세'}
          onClose={() => setDetail(null)}
          wide={selected.kind === 'meal'}
        >
          <div className="modal-body">
            <div className="detail-heading">
              <span className="tag">
                {selected.deletedAt
                  ? '휴지통'
                  : selected.actor === 'dot'
                    ? 'dot가 기록'
                    : '직접 기록'}
              </span>
              <span className="muted">{longDate(selected.date)}</span>
            </div>
            <h3 className="detail-title">{titleOf(selected)}</h3>
            <p>{description(selected)}</p>
            {selected.note && <p className="detail-note">{selected.note}</p>}
            {selected.kind === 'meal' &&
              selected.items.map((f, i) => (
                <div className="detail-food" key={i}>
                  <strong>{f.name}</strong>
                  <p>
                    {f.quantity} {f.unit === 'serving' ? '회 제공량' : f.unit} · 기준{' '}
                    {f.basisAmount} {f.unit}당 {f.kcal ?? '미상'} kcal
                  </p>
                  <p className="help">
                    {f.source.title}
                    {f.source.kind === 'estimate' ? ' · 추정' : ''} · {f.source.assumptions}
                  </p>
                  {f.source.url && (
                    <a target="_blank" rel="noreferrer" href={f.source.url}>
                      출처 보기 <ExternalLink size={12} />
                    </a>
                  )}
                </div>
              ))}
            {selected.kind === 'analysis' && (
              <>
                <h4>관찰</h4>
                <p className="pre-wrap">{selected.observations}</p>
                <h4>한계</h4>
                <p className="pre-wrap">{selected.limitations}</p>
                <h4>제안</h4>
                <p className="pre-wrap">{selected.suggestions}</p>
                <p className="help">
                  기준 데이터 버전 {selected.basedOnVersion}
                  {stale(selected, snapshot) ? ' · 원본 변경으로 재검토 필요' : ''}
                </p>
                <div className="evidence-links">
                  {selected.evidenceIds.map((id) => (
                    <button key={id} className="chip" onClick={() => setDetail(id)}>
                      <Link2 size={13} />
                      {snapshot.entries.find((e) => e.id === id)
                        ? titleOf(snapshot.entries.find((e) => e.id === id)!)
                        : '삭제된 근거'}
                    </button>
                  ))}
                </div>
              </>
            )}
            {!['meal', 'analysis'].includes(selected.kind) && (
              <dl className="detail-values">
                {Object.entries(inputOf(selected))
                  .filter(
                    ([k, v]) =>
                      !['kind', 'date', 'note', 'name', 'title'].includes(k) &&
                      v != null &&
                      v !== '',
                  )
                  .map(([k, v]) => (
                    <div key={k}>
                      <dt>
                        {{
                          kg: '몸무게',
                          representative: '대표 체중',
                          fasting: '공복',
                          minutes: '운동 시간 (분)',
                          distanceKm: '거리 (km)',
                          met: '운동 MET',
                          referenceMet: '기준 MET',
                          metSource: 'MET 출처',
                          includedInBaseline: '기준선 포함',
                          status: '상태',
                          heightCm: '키 (cm)',
                          birthDate: '생년월일',
                          age: '만 나이',
                          ageAsOf: '나이 기준일',
                          coefficient: '대사식 계수',
                          eligibility: '성인식 적용',
                          bodyFat: '체지방 (%)',
                          muscleKg: '근육량 (kg)',
                          waistCm: '허리둘레 (cm)',
                          factor: '활동 계수',
                          mode: '운동 포함 방식',
                          description: '설명',
                          source: '출처',
                          mealsComplete: '식사 기록 완료',
                          activityComplete: '활동 기록 완료',
                          sleepHours: '수면 (시간)',
                          fatigue: '피로',
                          hunger: '허기',
                          targetKg: '목표 체중',
                          reviewDate: '점검일',
                          confirmed: '사용자 확인',
                          feedback: '실천 메모',
                          analysisId: '분석 ID',
                          duplicateOf: '중복 원본',
                        }[k] ?? k}
                      </dt>
                      <dd>
                        {typeof v === 'boolean'
                          ? v
                            ? '예'
                            : '아니요'
                          : typeof v === 'object'
                            ? JSON.stringify(v)
                            : ({
                                male: '남성식',
                                female: '여성식',
                                unknown: '미확인',
                                adult: '일반 성인용',
                                not_applicable: '적용 안 함',
                                excludes_exercise: '별도 운동 제외',
                                includes_exercise: '운동 포함',
                                done: '완료',
                                planned: '계획',
                                active: '진행 중',
                                paused: '잠시 쉬기',
                                proposed: '제안',
                                accepted: '실천 중',
                                deferred: '나중에',
                              }[String(v)] ?? String(v))}
                      </dd>
                    </div>
                  ))}
              </dl>
            )}
            <details className="history">
              <summary>
                <History size={16} />
                수정 이력 · {history.length}건
              </summary>
              {historyError && <p className="error">{historyError}</p>}
              {[...history].reverse().map((h) => (
                <div className="history-item" key={h.id}>
                  <strong>
                    {{
                      create: '생성',
                      update: '수정',
                      delete: '휴지통 이동',
                      restore: '복원',
                      representative: '대표 체중 변경',
                    }[h.operation] ?? h.operation}{' '}
                    · {h.actor === 'dot' ? 'dot' : '홈페이지'}
                  </strong>
                  <small>
                    {new Date(h.at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
                  </small>
                  <details>
                    <summary>변경 전·후 보기</summary>
                    <pre>
                      {JSON.stringify(
                        {
                          이전: h.before ? inputOf(h.before) : null,
                          이후: h.after ? inputOf(h.after) : null,
                        },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                </div>
              ))}
              {!history.length && !historyError && (
                <p className="help">
                  이전 이력이 없어요. 가상 기본 기록에는 이력이 포함되지 않습니다.
                </p>
              )}
            </details>
            <p className="record-id">
              ID {selected.id} · 버전 {selected.version}
            </p>
          </div>
          <div className="modal-footer">
            {selected.deletedAt ? (
              <>
                <button
                  className="button danger"
                  onClick={() => {
                    setPurge(selected);
                    setPurgeText('');
                    setDetail(null);
                  }}
                >
                  영구 삭제
                </button>
                <button
                  className="button primary"
                  disabled={working}
                  onClick={() => toggleArchive(selected, true)}
                >
                  복원
                </button>
              </>
            ) : (
              <>
                <button
                  className="button secondary danger-text"
                  disabled={working}
                  onClick={() => toggleArchive(selected)}
                >
                  <Trash2 size={16} />
                  삭제
                </button>
                <button
                  className="button primary"
                  onClick={() => setEditor({ kind: selected.kind, entry: selected })}
                >
                  기록 수정
                </button>
              </>
            )}
          </div>
        </Modal>
      )}
      {purge && (
        <Modal title="기록을 영구 삭제할까요?" onClose={() => setPurge(null)}>
          <div className="modal-body">
            <p>
              <strong>{titleOf(purge)}</strong>의 원본·수정 이력과 이 기록을 근거로 연결된 분석·실천
              항목이 제거됩니다. 되돌릴 수 없습니다.
            </p>
            <Field label="확인하려면 ‘영구 삭제’를 입력하세요.">
              <input value={purgeText} onChange={(e) => setPurgeText(e.target.value)} />
            </Field>
          </div>
          <div className="modal-footer">
            <button className="button secondary" onClick={() => setPurge(null)}>
              취소
            </button>
            <button
              className="button danger"
              disabled={purgeText !== '영구 삭제' || working}
              onClick={() =>
                run(async () => {
                  await api.send('/entries/' + purge.id + '/purge', {
                    expectedVersion: purge.version,
                    confirmation: purgeText,
                  });
                  setPurge(null);
                }, '기록을 영구 삭제했어요.')
              }
            >
              영구 삭제
            </button>
          </div>
        </Modal>
      )}
      {importData && (
        <Modal title="백업 복원 확인" onClose={() => setImportData(null)}>
          <div className="modal-body">
            <p>
              원본 {importData.entries.length}개, 수정 이력 {importData.history.length}개가 들어
              있어요.
            </p>
            <p className="help">
              빈 계정에만 복원할 수 있어요. 파일 형식과 연결 관계는 저장 전에 검증합니다.
            </p>
          </div>
          <div className="modal-footer">
            <button className="button secondary" onClick={() => setImportData(null)}>
              취소
            </button>
            <button
              className="button primary"
              disabled={working}
              onClick={() =>
                run(async () => {
                  await api.send('/import', importData);
                  setImportData(null);
                }, '백업을 복원했어요.')
              }
            >
              검증하고 복원
            </button>
          </div>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
        </div>
      )}
    </div>
  );
}
