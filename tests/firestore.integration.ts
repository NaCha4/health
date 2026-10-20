import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, collection, getDocs } from 'firebase/firestore';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import request from 'supertest';
import { FirestoreStore } from '../functions/src/store.js';
import { HealthService } from '../functions/src/health.js';
import { createApp } from '../functions/src/app.js';
const projectId = 'demo-dot-health';
let env: RulesTestEnvironment;
const admin = initializeApp({ projectId }, 'integration');
beforeAll(async () => {
  if (
    process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' ||
    process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099'
  )
    throw new Error('Only explicit loopback emulators may run these tests');
  env = await initializeTestEnvironment({
    projectId,
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
  await env.clearFirestore();
});
afterAll(async () => {
  await env?.cleanup();
  await deleteApp(admin);
});
describe('실제 로컬 Firestore 규칙과 트랜잭션', () => {
  it('처방 변경 경쟁·실제 투여 재시도·백업을 격리된 Firestore에서 보존한다', async () => {
    const store = new FirestoreStore(getFirestore(admin)),
      h = new HealthService(store),
      uid = 'integrated-emulator';
    const plan = {
      kind: 'medication',
      date: '2026-10-07',
      name: 'SYNTHETIC fixture',
      dose: 'SYNTHETIC 1 unit',
      doseConfirmed: true,
      route: 'injection',
      schedule: 'SYNTHETIC schedule',
      status: 'active',
    };
    const p = await h.mutate(uid, 'web', 'create', 'emulator-integrated-plan', plan);
    const changes = await Promise.allSettled([
      h.mutate(uid, 'web', 'create', 'emulator-change-a', {
        ...plan,
        previousId: p.entry.id,
        status: 'paused',
      }),
      h.mutate(uid, 'web', 'create', 'emulator-change-b', {
        ...plan,
        previousId: p.entry.id,
        status: 'stopped',
      }),
    ]);
    expect(changes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(changes.filter((r) => r.status === 'rejected')).toHaveLength(1);
    const input = {
      kind: 'dose',
      date: '2026-10-07',
      medicationId: p.entry.id,
      status: 'taken',
      actualDose: 'SYNTHETIC 1 unit',
      occurredAt: '2026-10-07T09:00:00+09:00',
    };
    const [a, b] = await Promise.all([
      h.mutate(uid, 'web', 'create', 'emulator-integrated-dose', input),
      h.mutate(uid, 'web', 'create', 'emulator-integrated-dose', input),
    ]);
    expect(a).toEqual(b);
    const reloaded = new HealthService(new FirestoreStore(getFirestore(admin)));
    expect((await reloaded.snapshot(uid)).entries).toHaveLength(3);
    const backup = await reloaded.export(uid);
    await h.restoreBackup('integrated-restored-emulator', backup);
    expect(await h.snapshot('integrated-restored-emulator')).toEqual(await h.snapshot(uid));
  });
  it('실제 트랜잭션에서도 제안 참조와 사용자 결정을 보호하고 백업을 복원한다', async () => {
    const h = new HealthService(new FirestoreStore(getFirestore(admin))),
      uid = 'regression-emulator';
    const input = { kind: 'action', date: '2026-10-07', title: 'Synthetic integration action' };
    await expect(
      h.mutate(uid, 'dot', 'create', 'emulator-invalid-ref', { ...input, analysisId: 'missing' }),
    ).rejects.toMatchObject({ code: 'invalid_evidence' });
    const analysis = await h.mutate(uid, 'dot', 'create', 'emulator-valid-analysis', {
      kind: 'analysis',
      date: '2026-10-07',
      title: 'Synthetic analysis',
      from: '2026-10-07',
      to: '2026-10-07',
      observations: 'Fixture only',
      limitations: 'Fixture only',
      suggestions: 'Fixture only',
      basedOnVersion: 0,
      evidenceIds: [],
    });
    const linked = { ...input, analysisId: analysis.entry.id };
    const action = await h.mutate(uid, 'dot', 'create', 'emulator-valid-action', linked);
    await h.mutate(
      uid,
      'web',
      'update',
      'emulator-user-accept',
      { ...linked, status: 'accepted' },
      action.entry.id,
      1,
    );
    await expect(
      h.mutate(
        uid,
        'dot',
        'update',
        'emulator-dot-reset',
        { ...linked, status: 'proposed' },
        action.entry.id,
        2,
      ),
    ).rejects.toMatchObject({ code: 'user_decision' });
    await h.restoreBackup('regression-restored', await h.export(uid));
    expect(await h.snapshot('regression-restored')).toEqual(await h.snapshot(uid));
  });
  it('클라이언트 직접 조회·생성·목록 접근을 로그인 여부와 무관하게 차단한다', async () => {
    for (const ctx of [
      env.unauthenticatedContext(),
      env.authenticatedContext('owner'),
      env.authenticatedContext('other'),
    ]) {
      const db = ctx.firestore();
      await assertFails(getDoc(doc(db, 'users/owner/entries/example')));
      await assertFails(setDoc(doc(db, 'users/owner/entries/example'), { kg: 80 }));
      await assertFails(getDocs(collection(db, 'users/owner/entries')));
      await assertFails(getDoc(doc(db, 'oauthGrants/example')));
    }
  });
  it('Admin 저장은 실제 트랜잭션에서 idempotency·대표 변경·복원까지 처리된다', async () => {
    const h = new HealthService(new FirestoreStore(getFirestore(admin))),
      uid = 'transaction-fixture';
    const data = { kind: 'weight', date: '2026-10-07', kg: 80, representative: true };
    const [a, b] = await Promise.all([
      h.mutate(uid, 'web', 'create', 'fixture-create', data),
      h.mutate(uid, 'web', 'create', 'fixture-create', data),
    ]);
    expect(a.entry.id === b.entry.id).toBe(true);
    await h.mutate(uid, 'web', 'create', 'fixture-second', { ...data, kg: 81 });
    expect(
      (await h.snapshot(uid)).entries.filter((e) => e.kind === 'weight' && e.representative),
    ).toHaveLength(1);
    const backup = await h.export(uid);
    await h.restoreBackup('backup-fixture', backup);
    expect((await h.snapshot('backup-fixture')).entries).toHaveLength(2);
    const s = await h.snapshot(uid),
      first = s.entries.find((e) => e.id === a.entry.id)!;
    await h.mutate(uid, 'web', 'delete', 'fixture-delete', undefined, first.id, first.version);
    await h.purge(uid, first.id, first.version + 1, '영구 삭제');
    await expect(h.mutate(uid, 'web', 'create', 'fixture-create', data)).rejects.toMatchObject({
      status: 410,
    });
  });
  it('Firebase Auth 에뮬레이터의 ID 토큰을 검증한 소유자만 HTTP API를 사용한다', async () => {
    const signup = await fetch(
      'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=emulator-only',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ returnSecureToken: true }),
      },
    );
    const user = (await signup.json()) as { localId: string; idToken: string };
    expect(typeof user.localId).toBe('string');
    const app = createApp(
      new FirestoreStore(getFirestore(admin)),
      {
        allowedUids: [user.localId],
        origins: ['http://127.0.0.1:5173'],
        baseUrl: 'http://127.0.0.1:8787',
        frontendUrl: 'http://127.0.0.1:5173',
        clientId: 'fixture-client',
        redirectUris: ['http://127.0.0.1:5173/callback'],
      },
      async (token) => getAuth(admin).verifyIdToken(token, true),
    );
    expect(
      (await request(app).get('/v1/snapshot').auth(user.idToken, { type: 'bearer' })).status,
    ).toBe(200);
    expect(
      (await request(app).get('/v1/snapshot').auth('forged-token', { type: 'bearer' })).status,
    ).toBe(401);
  });
});
