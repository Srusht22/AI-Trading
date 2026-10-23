// Loads .env.server.local (if present) into process.env without overriding
// variables that are already set. Server-side scripts only.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function loadServerEnv(file = '.env.server.local') {
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trimStart().startsWith('#')) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

export function requireEnv(name) {
  const v = process.env[name];
  if (!v || v.startsWith('paste-')) {
    console.error(`Missing ${name}. Set it in the environment or in .env.server.local (see .env.server.example).`);
    process.exit(2);
  }
  return v;
}
