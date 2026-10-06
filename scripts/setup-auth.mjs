// Configure signing keys once, without displaying or committing private values.
import { generateKeyPairSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = path.join(root, 'node_modules/convex/bin/main.js');
function convex(args) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', timeout: 90000, windowsHide: true });
  if (result.status !== 0) throw new Error('Convex command failed. Check your connection and Convex login, then rerun npm run setup:auth.');
  return result.stdout;
}

const names = convex(['env', 'list', '--names-only']);
const hasPrivate = names.includes('JWT_PRIVATE_KEY');
const hasPublic = names.includes('JWKS');
if (hasPrivate && hasPublic) {
  console.log('Auth signing keys already configured; kept existing keys.');
} else if (hasPrivate || hasPublic) {
  throw new Error('Only one signing-key variable is configured. Restore the matching JWT_PRIVATE_KEY and JWKS pair in Convex before continuing.');
} else {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).trimEnd().replace(/\n/g, ' ');
  const jwks = JSON.stringify({ keys: [{ ...publicKey.export({ format: 'jwk' }), use: 'sig', alg: 'RS256' }] });
  const temporary = path.join(root, '.env.auth-setup.local');
  writeFileSync(temporary, `JWT_PRIVATE_KEY="${pem}"\nJWKS='${jwks}'\n`, { flag: 'wx', mode: 0o600 });
  try {
    convex(['env', 'set', '--from-file', temporary]);
    console.log('Auth signing keys configured on your selected Convex deployment.');
  } finally {
    unlinkSync(temporary);
  }
}
