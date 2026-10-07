import express, { type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { dateSchema } from '../../shared/schema.js';
import { calculateDay, summarize } from '../../shared/energy.js';
import { today, addDays } from '../../shared/dates.js';
import { AppError, HealthService } from './health.js';
import { OAuthService, type OAuthConfig } from './oauth.js';
import type { Store } from './store.js';
import { handleMcp, listEntries } from './mcp.js';
import { searchFood } from './nutrition.js';

export interface AppConfig extends OAuthConfig {
  allowedUids: string[];
  origins: string[];
  nutritionKeys?: { usda?: string; mfds?: string };
}
export type VerifyToken = (token: string) => Promise<{ uid: string }>;
type UserRequest = Request & { uid?: string };
export function createApp(store: Store, config: AppConfig, verify: VerifyToken) {
  const app = express(),
    health = new HealthService(store),
    oauth = new OAuthService(store, config);
  app.disable('x-powered-by');
  const buckets = new Map<string, { count: number; until: number }>();
  app.use('/oauth', (req, res, next) => {
    const now = Date.now(),
      key = req.ip ?? 'unknown';
    for (const [k, v] of buckets) if (v.until <= now) buckets.delete(k);
    const bucket = buckets.get(key) ?? { count: 0, until: now + 60000 };
    if (buckets.size >= 2000 && !buckets.has(key))
      return res.status(429).json({ error: 'temporarily_unavailable' });
    bucket.count++;
    buckets.set(key, bucket);
    if (bucket.count > 60) {
      res.set('Retry-After', '60');
      return res
        .status(429)
        .json({ error: 'temporarily_unavailable', message: '잠시 후 연결을 다시 시도하세요.' });
    }
    next();
  });
  app.use((req, res, next) => {
    res.set({
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    const origin = req.get('origin');
    if (origin && !config.origins.includes(origin))
      return res
        .status(403)
        .json({ code: 'origin_denied', message: '허용되지 않은 웹 출처입니다.' });
    if (origin)
      res.set({
        'Access-Control-Allow-Origin': origin,
        Vary: 'Origin',
        'Access-Control-Allow-Headers':
          'Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Expose-Headers': 'WWW-Authenticate, MCP-Session-Id',
      });
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.use(express.json({ limit: '8mb' }), express.urlencoded({ extended: false, limit: '16kb' }));
  const route =
    (fn: (req: UserRequest, res: Response) => Promise<unknown>) =>
    (req: Request, res: Response, next: NextFunction) => {
      Promise.resolve(fn(req, res)).catch(next);
    };
  const allowed = (uid: string) => {
    if (!config.allowedUids.includes(uid))
      throw new AppError(403, 'owner_required', '등록된 소유자 계정만 사용할 수 있습니다.');
  };
  const bearer = (req: Request) => {
    const auth = req.get('authorization') ?? '';
    if (!/^Bearer [^\s]{1,8192}$/.test(auth))
      throw new AppError(401, 'authentication_required', '로그인이 필요합니다.');
    return auth.slice(7);
  };
  // Middleware awaits verification before dispatching a protected route.
  const web = (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve()
      .then(async () => {
        let user;
        try {
          user = await verify(bearer(req));
        } catch {
          throw new AppError(401, 'authentication_required', '로그인이 필요합니다.');
        }
        allowed(user.uid);
        (req as UserRequest).uid = user.uid;
        next();
      })
      .catch(next);
  };
  app.get('/health', (_req, res) =>
    res.json({ ok: true, service: 'harugyeol-health', version: '1.0.0' }),
  );
  const metadata = (_req: Request, res: Response) => res.json(oauth.metadata());
  app.get('/.well-known/oauth-authorization-server', metadata);
  app.get(
    ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'],
    (_req, res) =>
      res.json({
        resource: oauth.resource,
        authorization_servers: [config.baseUrl],
        scopes_supported: ['health:read', 'health:write'],
        bearer_methods_supported: ['header'],
      }),
  );
  app.get(
    '/oauth/authorize',
    route(async (req, res) => res.redirect(303, await oauth.authorize(req.query))),
  );
  app.post(
    '/oauth/token',
    route(async (req, res) => res.json(await oauth.token(req.body))),
  );
  app.post(
    '/oauth/revoke',
    route(async (req, res) => {
      const b = z
        .object({ token: z.string().max(8192), client_id: z.string().max(300) })
        .parse(req.body);
      await oauth.revoke(b.token, b.client_id);
      res.sendStatus(200);
    }),
  );
  app.use('/v1', web);
  app.get(
    '/v1/snapshot',
    route(async (req, res) => {
      if (req.query.knownVersion !== undefined) {
        const version = z.coerce.number().int().nonnegative().parse(req.query.knownVersion);
        if ((await health.currentVersion(req.uid!)) === version) {
          res.json({ unchanged: true, version });
          return;
        }
      }
      res.json(await health.snapshot(req.uid!));
    }),
  );
  app.get(
    '/v1/entries',
    route(async (req, res) => {
      const q = z
          .object({
            from: dateSchema.optional(),
            to: dateSchema.optional(),
            kind: z.string().max(30).optional(),
            query: z.string().max(200).optional(),
            offset: z.coerce.number().int().min(0).default(0),
            limit: z.coerce.number().int().min(1).max(100).default(30),
            deleted: z.enum(['true', 'false']).optional(),
          })
          .parse(req.query),
        s = await health.snapshot(req.uid!);
      res.json({
        ...listEntries(s.entries, { ...q, deleted: q.deleted === 'true' }),
        version: s.version,
      });
    }),
  );
  app.post(
    '/v1/entries',
    route(async (req, res) =>
      res
        .status(201)
        .json(await health.mutate(req.uid!, 'web', 'create', req.body.requestId, req.body.entry)),
    ),
  );
  app.put(
    '/v1/entries/:id',
    route(async (req, res) =>
      res.json(
        await health.mutate(
          req.uid!,
          'web',
          'update',
          req.body.requestId,
          req.body.entry,
          String(req.params.id),
          req.body.expectedVersion,
        ),
      ),
    ),
  );
  for (const operation of ['delete', 'restore'] as const)
    app.post(
      '/v1/entries/:id/' + operation,
      route(async (req, res) =>
        res.json(
          await health.mutate(
            req.uid!,
            'web',
            operation,
            req.body.requestId,
            undefined,
            String(req.params.id),
            req.body.expectedVersion,
          ),
        ),
      ),
    );
  app.post(
    '/v1/entries/:id/purge',
    route(async (req, res) =>
      res.json(
        await health.purge(
          req.uid!,
          String(req.params.id),
          req.body.expectedVersion,
          req.body.confirmation,
        ),
      ),
    ),
  );
  app.get(
    '/v1/history',
    route(async (req, res) =>
      res.json(
        await health.history(req.uid!, typeof req.query.id === 'string' ? req.query.id : undefined),
      ),
    ),
  );
  app.get(
    '/v1/summary',
    route(async (req, res) => {
      const q = z
        .object({ from: dateSchema.default(addDays(today(), -6)), to: dateSchema.default(today()) })
        .parse(req.query);
      res.json(summarize(await health.snapshot(req.uid!), q.from, q.to));
    }),
  );
  app.get(
    '/v1/energy',
    route(async (req, res) =>
      res.json(calculateDay(await health.snapshot(req.uid!), dateSchema.parse(req.query.date))),
    ),
  );
  app.get(
    '/v1/export',
    route(async (req, res) => res.json(await health.export(req.uid!))),
  );
  app.post(
    '/v1/import',
    route(async (req, res) => res.json(await health.restoreBackup(req.uid!, req.body))),
  );
  app.get(
    '/v1/nutrition',
    route(async (req, res) => {
      const q = z
        .object({ query: z.string().min(2).max(120), provider: z.enum(['mfds', 'usda']) })
        .parse(req.query);
      res.json(await searchFood(q.query, q.provider, config.nutritionKeys ?? {}));
    }),
  );
  app.get(
    '/v1/connections',
    route(async (req, res) => res.json(await oauth.connections(req.uid!))),
  );
  app.delete(
    '/v1/connections',
    route(async (req, res) => res.json(await oauth.disconnect(req.uid!))),
  );
  app.get(
    '/v1/oauth/request',
    route(async (req, res) => res.json(await oauth.request(z.string().parse(req.query.id)))),
  );
  app.post(
    '/v1/oauth/approve',
    route(async (req, res) => {
      const b = z.object({ id: z.string().max(300), allow: z.boolean() }).parse(req.body);
      res.json(await oauth.approve(req.uid!, b.id, b.allow));
    }),
  );
  app.all(
    '/mcp',
    route(async (req, res) => {
      try {
        const p = await oauth.principal(bearer(req));
        allowed(p.uid);
        await handleMcp(req, res, p, health, config.nutritionKeys ?? {});
      } catch (e) {
        if (e instanceof AppError && e.status === 401)
          res.set(
            'WWW-Authenticate',
            `Bearer resource_metadata="${config.baseUrl}/.well-known/oauth-protected-resource", scope="health:read health:write"`,
          );
        throw e;
      }
    }),
  );
  app.use((_req, res) =>
    res.status(404).json({ code: 'not_found', message: '요청한 경로가 없습니다.' }),
  );
  app.use((e: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;
    const status =
      e instanceof AppError
        ? e.status
        : e instanceof z.ZodError
          ? 400
          : (e as { status?: number })?.status === 413
            ? 413
            : 500;
    res.status(status).json({
      code:
        e instanceof AppError ? e.code : e instanceof z.ZodError ? 'validation' : 'request_failed',
      error: e instanceof AppError ? e.code : 'invalid_request',
      message:
        e instanceof AppError
          ? e.message
          : e instanceof z.ZodError
            ? '입력 형식을 확인하세요: ' +
              e.issues
                .slice(0, 3)
                .map((i) => i.path.join('.') + ' ' + i.message)
                .join(', ')
            : '요청을 처리하지 못했습니다. 잠시 후 다시 시도하세요.',
    });
  });
  return app;
}
