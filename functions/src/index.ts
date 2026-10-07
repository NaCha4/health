import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { createApp } from './app.js';
import { FirestoreStore } from './store.js';

initializeApp();
const base = defineString('PUBLIC_BASE_URL', {
  default: '',
  description: '함수의 직접 Cloud Run HTTPS 주소 (https://api-....run.app). 경로나 끝의 / 제외',
});
const frontend = defineString('FRONTEND_URL', {
  description: 'GitHub Pages 전체 주소. 예: https://USER.github.io/REPO/',
});
const owner = defineString('OWNER_UID', {
  default: '',
  description: 'Firebase Authentication에서 확인한 소유자 UID',
});
const client = defineString('OAUTH_CLIENT_ID', {
  default: 'harugyeol-dot',
  description: 'ChatGPT 연결에 등록할 공개 OAuth 클라이언트 ID (비밀 아님)',
});
const redirects = defineString('OAUTH_REDIRECT_URIS', {
  default: '',
  description: 'ChatGPT 설정 화면의 정확한 OAuth 콜백 HTTPS 주소. 쉼표 구분',
});
const database = defineString('FIRESTORE_DATABASE_ID', { default: '(default)' });
// Optional provider keys remain server-side. No VITE_ prefix or key creation here.
let app: ReturnType<typeof createApp> | undefined;
export const api = onRequest(
  {
    region: process.env.HEALTH_FUNCTION_REGION || 'asia-northeast3',
    memory: '256MiB',
    timeoutSeconds: 60,
    maxInstances: 3,
    invoker: 'public',
  },
  (req, res) => {
    try {
      if (!app) {
        const baseUrl = base.value().replace(/\/$/, ''),
          frontendUrl = frontend.value(),
          redirectUris = redirects
            .value()
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
        if (
          !baseUrl.startsWith('https://') ||
          new URL(baseUrl).pathname !== '/' ||
          !frontendUrl.startsWith('https://') ||
          !owner.value() ||
          !client.value() ||
          redirectUris.some((s) => !s.startsWith('https://') || new URL(s).hash)
        )
          throw new Error('invalid configuration');
        app = createApp(
          new FirestoreStore(getFirestore(database.value())),
          {
            baseUrl,
            frontendUrl,
            clientId: client.value(),
            redirectUris,
            allowedUids: [owner.value()],
            origins: [new URL(frontendUrl).origin],
            nutritionKeys: { usda: process.env.USDA_API_KEY, mfds: process.env.MFDS_API_KEY },
          },
          async (token) => getAuth().verifyIdToken(token, true),
        );
      }
      app(req, res);
    } catch {
      res
        .status(503)
        .json({ code: 'configuration_required', message: '서버 연결 설정을 확인해야 합니다.' });
    }
  },
);
