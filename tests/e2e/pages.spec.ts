import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { admin, createOwner, signIn } from './helpers';

/**
 * The deployable artefact as Cloudflare Pages runs it: the production build
 * plus Pages Functions on the local workerd runtime (`wrangler pages dev`),
 * talking to the local Supabase stack — with a real diagnostics agent
 * process connected through the agent API.
 */

test('Function responses carry their own security headers (the _headers file does not reach them)', async ({ request }) => {
  for (const res of [await request.get('/api/health'), await request.post('/api/agent/claim', { data: {} })]) {
    const h = res.headers();
    expect(h['content-security-policy']).toContain("default-src 'none'");
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['cache-control']).toContain('no-store');
    expect(h['access-control-allow-origin']).toBeUndefined();
  }
  const claim = await request.post('/api/agent/claim', { data: {} });
  expect(claim.status()).toBe(401);
  expect((await claim.json()).error.code).toBe('unauthorized');
});

test('static responses carry the CSP and deep links survive a reload', async ({ page, request }) => {
  const res = await request.get('/connections');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(res.headers()['x-robots-tag']).toContain('noindex');

  const email = await createOwner('pages-deeplink');
  await signIn(page, email);
  await page.goto('/connections');
  await expect(page.getByRole('heading', { level: 1, name: 'Connections & VPS' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Connections & VPS' })).toBeVisible();
});

test.describe('diagnostic task, end to end', () => {
  let worker: ChildProcess | undefined;
  let agentId: string | undefined;
  const output: string[] = [];

  test.afterEach(async () => {
    worker?.kill('SIGTERM');
    if (agentId) await admin.rpc('admin_revoke_agent', { p_agent_id: agentId });
  });

  test('a real agent runs a health check requested from the browser', async ({ page, baseURL }) => {
    const violations: string[] = [];
    page.on('console', (m) => {
      if (/Content Security Policy|Trusted Type/i.test(m.text())) violations.push(m.text());
    });

    // Register an agent the way scripts/register-agent.mjs does (token never leaves this process).
    const token = `tpa_${randomBytes(32).toString('base64url')}`;
    const { data, error } = await admin.rpc('admin_register_agent', {
      p_display_name: 'E2E diagnostics agent',
      p_capabilities: ['system.health_check'],
      p_token_sha256: `\\x${createHash('sha256').update(token).digest('hex')}`,
      p_max_concurrent_tasks: 1,
    });
    expect(error).toBeNull();
    agentId = data as string;

    const email = await createOwner('pages-diag');
    await signIn(page, email);
    await page.goto('/connections');
    const section = page.locator('section[aria-labelledby="diag-title"]');
    const run = section.getByRole('button', { name: 'Run health check' });

    // Agent registered but not running: honest "never connected", action disabled.
    const agentRow = section.getByRole('listitem').filter({ hasText: 'E2E diagnostics agent' });
    await expect(agentRow.getByText('Never connected')).toBeVisible();
    await expect(run).toBeDisabled();

    worker = spawn(process.execPath, ['agent/diagnostics-worker.mjs'], {
      env: { ...process.env, TRADEPILOT_API_URL: baseURL!, TRADEPILOT_AGENT_TOKEN: token },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    worker.stdout?.on('data', (d) => output.push(String(d)));
    worker.stderr?.on('data', (d) => output.push(String(d)));

    // The heartbeat reaches the browser (Realtime or the fallback refresh).
    await expect(agentRow.getByText('Online')).toBeVisible({ timeout: 30_000 });
    await expect(run).toBeEnabled();
    await run.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Succeeded').first()).toBeVisible({ timeout: 30_000 });
    await expect(dialog.getByText('API round trip (median of 3)')).toBeVisible();
    await expect(dialog.getByText('Agent clock vs server')).toBeVisible();
    await expect(dialog.getByText(/#1 · E2E diagnostics agent/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(section.getByRole('list', { name: 'Recent tasks' }).getByText('Succeeded')).toBeVisible();

    // The worker never prints its token.
    expect(output.join('')).not.toContain(token);
    expect(output.join('')).toMatch(/succeeded/);
    expect(violations).toEqual([]);
  });
});
