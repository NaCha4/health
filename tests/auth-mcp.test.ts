import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createHash } from 'node:crypto';
import { MemoryStore } from '../functions/src/store.js';
import { OAuthService } from '../functions/src/oauth.js';
import { createApp, type AppConfig } from '../functions/src/app.js';
const config: AppConfig = {
  baseUrl: 'https://fixture.example',
  frontendUrl: 'https://site.example/health/',
  clientId: 'fixture-client',
  redirectUris: ['https://chatgpt.com/fixture-callback'],
  origins: ['https://site.example'],
  allowedUids: ['owner'],
};
const verifier = 'fixture-verifier-for-unit-tests-only-'.repeat(2),
  challenge = createHash('sha256').update(verifier).digest('base64url');
const query = {
  client_id: config.clientId,
  redirect_uri: config.redirectUris[0],
  response_type: 'code',
  code_challenge: challenge,
  code_challenge_method: 'S256',
  scope: 'health:read health:write',
  state: 'fixture-state',
  resource: config.baseUrl + '/mcp',
};
function fixture() {
  let time = Date.now();
  const store = new MemoryStore(),
    oauth = new OAuthService(store, config, () => time),
    app = createApp(store, config, async (token) => {
      if (token === 'fixture-owner-session') return { uid: 'owner' };
      if (token === 'fixture-other-session') return { uid: 'other' };
      throw new Error('invalid');
    });
  return { oauth, app, store, advance: (ms: number) => (time += ms) };
}
async function authorize(o: OAuthService, scopes = 'health:read health:write') {
  const url = await o.authorize({ ...query, scope: scopes }),
    id = new URLSearchParams(new URL(url).hash.split('?')[1]).get('request')!;
  const approved = await o.approve('owner', id, true),
    code = new URL(approved.redirectUrl).searchParams.get('code')!;
  return {
    id,
    code,
    body: {
      client_id: config.clientId,
      resource: query.resource,
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      redirect_uri: query.redirect_uri,
    },
  };
}
describe('OAuth 보안 경계', () => {
  it('등록 콜백·PKCE·대상·scope를 검증한다', async () => {
    const { oauth } = fixture();
    for (const patch of [
      { redirect_uri: 'https://evil.example' },
      { resource: 'https://evil.example/mcp' },
      { code_challenge_method: 'plain' },
      { scope: 'admin' },
      { client_id: 'other' },
    ])
      await expect(oauth.authorize({ ...query, ...patch })).rejects.toBeDefined();
  });
  it('승인과 인증 코드는 일회용이고 잘못된 verifier는 실패한다', async () => {
    const { oauth } = fixture(),
      a = await authorize(oauth);
    await expect(oauth.approve('owner', a.id, true)).rejects.toMatchObject({
      code: 'expired_request',
    });
    await expect(oauth.token({ ...a.body, code_verifier: 'y'.repeat(64) })).rejects.toMatchObject({
      code: 'invalid_grant',
    });
    const token = await oauth.token(a.body);
    expect((await oauth.principal(token.access_token)).uid === 'owner').toBe(true);
    await expect(oauth.token(a.body)).rejects.toMatchObject({ code: 'invalid_grant' });
  });
  it('refresh token 재사용은 해당 연결 전체를 취소한다', async () => {
    const { oauth } = fixture(),
      a = await authorize(oauth),
      first = await oauth.token(a.body);
    const body = {
      client_id: config.clientId,
      resource: query.resource,
      grant_type: 'refresh_token',
      refresh_token: first.refresh_token,
    };
    const second = await oauth.token(body);
    await expect(oauth.token(body)).rejects.toMatchObject({ code: 'invalid_grant' });
    await expect(oauth.principal(second.access_token)).rejects.toMatchObject({
      code: 'invalid_token',
    });
  });
  it('access 만료·연결 해제가 즉시 반영된다', async () => {
    const { oauth, advance } = fixture(),
      a = await authorize(oauth),
      t = await oauth.token(a.body);
    advance(901000);
    await expect(oauth.principal(t.access_token)).rejects.toMatchObject({ status: 401 });
    const second = await oauth.token({
      client_id: config.clientId,
      resource: query.resource,
      grant_type: 'refresh_token',
      refresh_token: t.refresh_token,
    });
    await oauth.disconnect('owner');
    await expect(oauth.principal(second.access_token)).rejects.toMatchObject({ status: 401 });
  });
  it('거절된 동의는 코드를 발급하지 않는다', async () => {
    const { oauth } = fixture(),
      url = await oauth.authorize(query),
      id = new URLSearchParams(new URL(url).hash.split('?')[1]).get('request')!;
    const denied = await oauth.approve('owner', id, false);
    expect(new URL(denied.redirectUrl).searchParams.has('code')).toBe(false);
    expect(new URL(denied.redirectUrl).searchParams.get('state')).toBe(query.state);
  });
});
describe('HTTP 인증·MCP 공통 저장', () => {
  it('MCP도 실천 참조와 사용자의 채택 상태를 서버에서 보호한다', async () => {
    const { app, oauth } = fixture(),
      a = await authorize(oauth),
      token = await oauth.token(a.body);
    const call = async (name: string, args: unknown) => {
      const response = await request(app)
        .post('/mcp')
        .auth(token.access_token, { type: 'bearer' })
        .set('Accept', 'application/json, text/event-stream')
        .send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
      expect(response.status).toBe(200);
      return {
        error: response.body.result.isError,
        data: JSON.parse(response.body.result.content[0].text),
      };
    };
    const input = {
      kind: 'action',
      date: '2026-10-07',
      title: 'Synthetic decision',
      status: 'proposed',
      note: '',
      feedback: '',
    };
    const invalid = await call('propose_action', {
      requestId: 'mcp-invalid-action-ref',
      entry: { ...input, analysisId: 'missing-analysis' },
    });
    expect(invalid.error).toBe(true);
    expect(invalid.data.code).toBe('invalid_evidence');
    const created = await call('propose_action', { requestId: 'mcp-valid-proposal', entry: input });
    expect(created.error).not.toBe(true);
    await request(app)
      .put('/v1/entries/' + created.data.entry.id)
      .auth('fixture-owner-session', { type: 'bearer' })
      .send({
        requestId: 'web-accept-proposal',
        expectedVersion: 1,
        entry: { ...input, status: 'accepted' },
      })
      .expect(200);
    const reset = await call('update_health_entry', {
      requestId: 'mcp-reset-proposal',
      id: created.data.entry.id,
      expectedVersion: 2,
      entry: input,
    });
    expect(reset.error).toBe(true);
    expect(reset.data.code).toBe('user_decision');
    const snapshot = await request(app)
      .get('/v1/snapshot')
      .auth('fixture-owner-session', { type: 'bearer' });
    expect(snapshot.body.entries).toHaveLength(1);
    expect(snapshot.body.entries[0]).toMatchObject({ status: 'accepted', version: 2 });
  });
  it('미인증·다른 UID·위조 토큰의 읽기 쓰기 내보내기를 차단한다', async () => {
    const { app } = fixture();
    for (const path of ['/v1/snapshot', '/v1/export', '/v1/history', '/v1/connections']) {
      expect((await request(app).get(path)).status).toBe(401);
      expect(
        (await request(app).get(path).auth('fixture-other-session', { type: 'bearer' })).status,
      ).toBe(403);
    }
    expect(
      (await request(app).post('/v1/entries').auth('forged', { type: 'bearer' }).send({})).status,
    ).toBe(401);
  });
  it('허용 CORS만 응답하며 인증 없는 MCP에 discovery를 제공한다', async () => {
    const { app } = fixture();
    expect((await request(app).get('/health').set('Origin', 'https://evil.example')).status).toBe(
      403,
    );
    const r = await request(app).options('/v1/snapshot').set('Origin', config.origins[0]);
    expect(r.headers['access-control-allow-origin']).toBe(config.origins[0]);
    const m = await request(app).post('/mcp').send({});
    expect(m.status).toBe(401);
    expect(m.headers['www-authenticate']).toContain('resource_metadata=');
    const d = await request(app).get('/.well-known/oauth-authorization-server');
    expect(d.body.code_challenge_methods_supported).toEqual(['S256']);
  });
  it('실제 MCP HTTP 호출이 웹과 동일한 기록을 만들고 읽는다', async () => {
    const { app, oauth } = fixture(),
      a = await authorize(oauth),
      t = await oauth.token(a.body);
    const call = (method: string, params: any = {}) =>
      request(app)
        .post('/mcp')
        .auth(t.access_token, { type: 'bearer' })
        .set('Accept', 'application/json, text/event-stream')
        .send({ jsonrpc: '2.0', id: 1, method, params });
    const init = await call('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'fixture', version: '1' },
    });
    expect(init.status).toBe(200);
    expect(init.body.result.serverInfo.name).toBe('harugyeol-health');
    const list = await call('tools/list');
    expect(list.body.result.tools).toHaveLength(11);
    const created = await call('tools/call', {
      name: 'create_health_entry',
      arguments: {
        requestId: 'mcp-fixture-request',
        entry: { kind: 'weight', date: '2026-10-07', kg: 80 },
      },
    });
    expect(created.body.result.isError).not.toBe(true);
    const web = await request(app)
      .get('/v1/snapshot')
      .auth('fixture-owner-session', { type: 'bearer' });
    expect(web.body.entries).toHaveLength(1);
    expect(web.body.entries[0].kg).toBe(80);
    const row = web.body.entries[0];
    await request(app)
      .put('/v1/entries/' + row.id)
      .auth('fixture-owner-session', { type: 'bearer' })
      .send({
        requestId: 'web-edit-request',
        expectedVersion: 1,
        entry: { kind: 'weight', date: row.date, kg: 81 },
      })
      .expect(200);
    const read = await call('tools/call', { name: 'list_health_entries', arguments: {} });
    expect(JSON.parse(read.body.result.content[0].text).entries[0].kg).toBe(81);
  });
  it('조회 권한만 있는 MCP 연결은 기록할 수 없다', async () => {
    const { app, oauth } = fixture(),
      a = await authorize(oauth, 'health:read'),
      t = await oauth.token(a.body);
    const r = await request(app)
      .post('/mcp')
      .auth(t.access_token, { type: 'bearer' })
      .set('Accept', 'application/json, text/event-stream')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'create_health_entry',
          arguments: {
            requestId: 'read-only-request',
            entry: { kind: 'weight', date: '2026-10-07', kg: 80 },
          },
        },
      });
    expect(r.body.result.isError).toBe(true);
  });
});
