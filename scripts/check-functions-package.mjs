import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Use the same file selection as the pinned Firebase CLI uploader.
const require = createRequire(import.meta.url);
const { readdirRecursive } = require('firebase-tools/lib/fsAsync');
const root = path.resolve(import.meta.dirname, '..');
const config = JSON.parse(await readFile(path.join(root, 'firebase.json'), 'utf8')).functions[0];
const source = path.resolve(root, config.source);
const pkg = JSON.parse(await readFile(path.join(source, 'package.json'), 'utf8'));
const files = await readdirRecursive({ path: source, ignoreStrings: config.ignore });
const included = new Set(files.map((file) => path.resolve(file.name)));
const pending = [path.resolve(source, pkg.main)];
const visited = new Set();
while (pending.length) {
  const file = pending.pop();
  if (visited.has(file)) continue;
  if (!included.has(file))
    throw new Error(`Deployment package is missing ${path.relative(source, file)}`);
  visited.add(file);
  const text = await readFile(file, 'utf8');
  for (const match of text.matchAll(/(?:from\s*|import\s*\(?\s*)['"](\.[^'"]+)['"]/g)) {
    pending.push(path.resolve(path.dirname(file), match[1]));
  }
}
for (const file of included) {
  if (path.basename(file).startsWith('.env') || /\.(pem|key)$/.test(file)) {
    throw new Error('A private configuration file is included in the deployment package.');
  }
}
console.log(
  `Functions package verified: ${visited.size} runtime modules included, private config excluded.`,
);
