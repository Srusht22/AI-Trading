#!/usr/bin/env node
/**
 * Scans the production build for anything that must never reach a browser:
 * service-role JWTs, sb_secret_ keys, or the configured service-role key value.
 * Run after `npm run build` (wired into `npm run check:secrets`).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadServerEnv } from './load-server-env.mjs';

loadServerEnv();
const root = 'dist';
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(p);
  }
})(root);

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const findings = [];
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  if (/sb_secret_[A-Za-z0-9_-]{10,}/.test(text)) findings.push(`${file}: contains an sb_secret_ key`);
  if (serviceKey && !serviceKey.startsWith('paste-') && text.includes(serviceKey)) findings.push(`${file}: contains SUPABASE_SERVICE_ROLE_KEY`);
  for (const jwt of text.match(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g) ?? []) {
    try {
      const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
      if (payload.role === 'service_role') findings.push(`${file}: contains a service_role JWT`);
    } catch {
      /* not a JWT */
    }
  }
  if (file.endsWith('.map')) findings.push(`${file}: source map shipped in production build`);
}

if (findings.length) {
  console.error('Secret scan FAILED:\n' + findings.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
console.log(`Secret scan passed: ${files.length} files in ${root}/ contain no privileged keys or source maps.`);
