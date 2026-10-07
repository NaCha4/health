import { randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { AppError, hash } from './health.js';
import type { Store, Tx } from './store.js';
export interface OAuthConfig {
  baseUrl: string;
  frontendUrl: string;
  clientId: string;
  redirectUris: string[];
}
export interface Principal {
  uid: string;
  scopes: string[];
  grantId: string;
}
interface RequestData {
  id: string;
  clientId: string;
  redirectUri: string;
  challenge: string;
  state: string;
  scopes: string[];
  resource: string;
  expires: number;
  consumed: boolean;
}
interface CodeData extends RequestData {
  uid: string;
  used: boolean;
}
interface Grant {
  id: string;
  uid: string;
  scopes: string[];
  revoked: boolean;
  expires: number;
}
interface TokenData {
  grantId: string;
  clientId: string;
  resource: string;
  expires: number;
  used?: boolean;
}
const secret = () => randomBytes(32).toString('base64url');
const string = (x: unknown) => z.string().min(1).max(2048).parse(x);
const equal = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export class OAuthService {
  constructor(
    public store: Store,
    public config: OAuthConfig,
    private now = () => Date.now(),
  ) {}
  get resource() {
    return this.config.baseUrl + '/mcp';
  }
  metadata() {
    return {
      issuer: this.config.baseUrl,
      authorization_endpoint: this.config.baseUrl + '/oauth/authorize',
      token_endpoint: this.config.baseUrl + '/oauth/token',
      revocation_endpoint: this.config.baseUrl + '/oauth/revoke',
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['health:read', 'health:write'],
      authorization_response_iss_parameter_supported: true,
    };
  }
  validateRequest(
    query: Record<string, unknown>,
  ): Omit<RequestData, 'id' | 'expires' | 'consumed'> {
    const clientId = string(query.client_id),
      redirectUri = string(query.redirect_uri),
      challenge = string(query.code_challenge),
      state = string(query.state),
      resource = string(query.resource);
    if (clientId !== this.config.clientId || !this.config.redirectUris.includes(redirectUri))
      throw new AppError(
        400,
        'invalid_client',
        '등록된 클라이언트와 정확한 콜백 주소가 필요합니다.',
      );
    if (
      query.response_type !== 'code' ||
      query.code_challenge_method !== 'S256' ||
      !/^[A-Za-z0-9_-]{43}$/.test(challenge) ||
      resource !== this.resource
    )
      throw new AppError(
        400,
        'invalid_request',
        'OAuth 요청의 형식 또는 대상이 올바르지 않습니다.',
      );
    const scopes = [...new Set(string(query.scope).split(' '))];
    if (
      !scopes.includes('health:read') ||
      scopes.some((s) => !['health:read', 'health:write'].includes(s))
    )
      throw new AppError(400, 'invalid_scope', '지원하지 않는 권한 요청입니다.');
    return { clientId, redirectUri, challenge, state, scopes, resource };
  }
  async authorize(query: Record<string, unknown>) {
    const data = this.validateRequest(query),
      id = secret();
    await this.store.transaction(async (tx) => {
      tx.set('oauthRequests/' + hash(id), {
        ...data,
        id: hash(id),
        expires: this.now() + 600000,
        consumed: false,
      });
    });
    const url = new URL(this.config.frontendUrl);
    url.hash = '/connect?request=' + encodeURIComponent(id);
    return url.toString();
  }
  async request(id: string) {
    return this.store.transaction(async (tx) => {
      const r = await tx.get<RequestData>('oauthRequests/' + hash(string(id)));
      if (!r || r.expires < this.now() || r.consumed)
        throw new AppError(
          400,
          'expired_request',
          '연결 요청이 만료되었습니다. dot에서 다시 연결해 주세요.',
        );
      return { clientId: r.clientId, scopes: r.scopes, expires: r.expires };
    });
  }
  async approve(uid: string, id: string, allow: boolean) {
    const code = secret();
    return this.store.transaction(async (tx) => {
      const path = 'oauthRequests/' + hash(string(id)),
        r = await tx.get<RequestData>(path);
      if (!r || r.expires < this.now() || r.consumed)
        throw new AppError(400, 'expired_request', '연결 요청이 만료되었습니다.');
      tx.set(path, { ...r, consumed: true });
      const url = new URL(r.redirectUri);
      url.searchParams.set('state', r.state);
      url.searchParams.set('iss', this.config.baseUrl);
      if (allow) {
        tx.set('oauthCodes/' + hash(code), {
          ...r,
          uid,
          used: false,
          expires: this.now() + 120000,
        });
        url.searchParams.set('code', code);
      } else url.searchParams.set('error', 'access_denied');
      return { redirectUrl: url.toString() };
    });
  }
  private mint(tx: Tx, grant: Grant) {
    const access = secret(),
      refresh = secret(),
      data = { grantId: grant.id, clientId: this.config.clientId, resource: this.resource };
    tx.set('oauthAccess/' + hash(access), { ...data, expires: this.now() + 900000 });
    tx.set('oauthRefresh/' + hash(refresh), {
      ...data,
      expires: Math.min(this.now() + 30 * 86400000, grant.expires),
      used: false,
    });
    return {
      access_token: access,
      refresh_token: refresh,
      token_type: 'Bearer',
      expires_in: 900,
      scope: grant.scopes.join(' '),
    };
  }
  async token(body: Record<string, unknown>) {
    if (body.client_id !== this.config.clientId || body.resource !== this.resource)
      throw new AppError(400, 'invalid_grant', '클라이언트 또는 대상이 일치하지 않습니다.');
    if (body.grant_type === 'authorization_code') {
      const code = string(body.code),
        verifier = string(body.code_verifier);
      if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier))
        throw new AppError(400, 'invalid_grant', 'PKCE 검증값 형식이 올바르지 않습니다.');
      return this.store.transaction(async (tx) => {
        const path = 'oauthCodes/' + hash(code),
          c = await tx.get<CodeData>(path);
        const challenge = Buffer.from(hash(verifier), 'hex').toString('base64url');
        if (
          !c ||
          c.used ||
          c.expires < this.now() ||
          c.clientId !== body.client_id ||
          c.redirectUri !== body.redirect_uri ||
          c.resource !== body.resource ||
          !equal(c.challenge, challenge)
        )
          throw new AppError(400, 'invalid_grant', '인증 코드를 확인할 수 없습니다.');
        const grant: Grant = {
          id: secret(),
          uid: c.uid,
          scopes: c.scopes,
          revoked: false,
          expires: this.now() + 90 * 86400000,
        };
        tx.set(path, { ...c, used: true });
        tx.set('oauthGrants/' + grant.id, grant);
        return this.mint(tx, grant);
      });
    }
    if (body.grant_type === 'refresh_token') {
      const path = 'oauthRefresh/' + hash(string(body.refresh_token));
      const result = await this.store.transaction(async (tx) => {
        const token = await tx.get<TokenData>(path),
          grant = token ? await tx.get<Grant>('oauthGrants/' + token.grantId) : null;
        if (
          !token ||
          !grant ||
          token.expires < this.now() ||
          grant.expires < this.now() ||
          grant.revoked ||
          token.clientId !== body.client_id ||
          token.resource !== body.resource
        )
          return null;
        if (token.used) {
          tx.set('oauthGrants/' + grant.id, { ...grant, revoked: true });
          return null;
        }
        tx.set(path, { ...token, used: true });
        return this.mint(tx, grant);
      });
      if (!result)
        throw new AppError(
          400,
          'invalid_grant',
          '연결이 만료되었거나 해제되었습니다. 다시 연결하세요.',
        );
      return result;
    }
    throw new AppError(400, 'unsupported_grant_type', '지원하지 않는 인증 방식입니다.');
  }
  async principal(access: string): Promise<Principal> {
    return this.store.transaction(async (tx) => {
      const token = await tx.get<TokenData>('oauthAccess/' + hash(access));
      const grant = token ? await tx.get<Grant>('oauthGrants/' + token.grantId) : null;
      if (
        !token ||
        !grant ||
        token.expires < this.now() ||
        grant.expires < this.now() ||
        grant.revoked ||
        token.resource !== this.resource
      )
        throw new AppError(401, 'invalid_token', '연결 인증이 필요합니다.');
      return { uid: grant.uid, scopes: grant.scopes, grantId: grant.id };
    });
  }
  async revoke(token: string, clientId: string) {
    if (clientId !== this.config.clientId)
      throw new AppError(400, 'invalid_client', '클라이언트를 확인하세요.');
    await this.store.transaction(async (tx) => {
      const data =
        (await tx.get<TokenData>('oauthRefresh/' + hash(token))) ??
        (await tx.get<TokenData>('oauthAccess/' + hash(token)));
      const g = data ? await tx.get<Grant>('oauthGrants/' + data.grantId) : null;
      if (g) tx.set('oauthGrants/' + g.id, { ...g, revoked: true });
    });
  }
  async disconnect(uid: string) {
    return this.store.transaction(async (tx) => {
      const grants = await tx.list<Grant>('oauthGrants', {
        field: 'uid',
        equals: uid,
        limit: 10001,
      });
      if (grants.length > 10000)
        throw new AppError(413, 'connection_limit', '연결 수가 많아 전체 해제를 중단했습니다.');
      const active = grants.filter((g) => !g.revoked && g.expires > this.now());
      if (active.length > 450)
        throw new AppError(413, 'connection_limit', '활성 연결이 많아 전체 해제를 중단했습니다.');
      for (const g of active) tx.set('oauthGrants/' + g.id, { ...g, revoked: true });
      return { revoked: active.length };
    });
  }
  async connections(uid: string) {
    return this.store.transaction(async (tx) => {
      const all = await tx.list<Grant>('oauthGrants', { field: 'uid', equals: uid, limit: 400 });
      return all
        .filter((g) => !g.revoked && g.expires > this.now())
        .map((g) => ({ scopes: g.scopes, expires: g.expires }));
    });
  }
}
