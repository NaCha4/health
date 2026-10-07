import { createApp } from '../functions/src/app.js';
import { MemoryStore } from '../functions/src/store.js';
import { demoSnapshot } from '../shared/demo.js';
const store = new MemoryStore(),
  snapshot = demoSnapshot();
await store.transaction(async (tx) => {
  tx.set('users/local-demo', { version: snapshot.version });
  for (const e of snapshot.entries) tx.set('users/local-demo/entries/' + e.id, e);
});
const app = createApp(
  store,
  {
    baseUrl: 'http://127.0.0.1:8787',
    frontendUrl: 'http://127.0.0.1:5173',
    clientId: 'local-demo',
    redirectUris: ['http://127.0.0.1:5173/callback'],
    origins: ['http://127.0.0.1:5173'],
    allowedUids: ['local-demo'],
  },
  async (token) => {
    if (token !== 'local-demo-only') throw new Error('invalid demo token');
    return { uid: 'local-demo' };
  },
);
app.listen(8787, '127.0.0.1', () =>
  console.log('Local fixture API listening on http://127.0.0.1:8787 (memory only)'),
);
