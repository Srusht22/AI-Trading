import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

    const email = await createOwner('pages-diag');
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

/**
 * MT5 connector in the browser. The connector process is the real Python
 * loop and HTTP client (connector/tests/e2e_fixture_session.py); only
 * MetaTrader 5 is replaced by a TEST FIXTURE terminal whose server is named
 * "TradePilot-TEST-FIXTURE" and whose prices step deterministically. Nothing
 * shown in this test is market data.
 */
test.describe('MT5 connector (test-fixture terminal)', () => {
  test.setTimeout(240_000);
  let fixture: ChildProcess | undefined;
  let controlDir = '';

  test.afterEach(async () => {
    if (controlDir) writeFileSync(join(controlDir, 'stop'), '1');
    await new Promise((r) => setTimeout(r, 1500));
    fixture?.kill('SIGTERM');
    const agentId = controlDir && existsSync(join(controlDir, 'agent_id')) ? readFileSync(join(controlDir, 'agent_id'), 'utf8') : null;
    if (agentId) await admin.rpc('admin_revoke_agent', { p_agent_id: agentId });
  });

  test('pair, verify the demo account, watch real pipeline updates, go stale, disconnect and block a real account', async ({ page, baseURL }) => {
    const violations: string[] = [];
    page.on('console', (m) => {
      if (/Content Security Policy|Trusted Type/i.test(m.text())) violations.push(m.text());
    });
    const email = await createOwner('pages-mt5');
    await signIn(page, email);
    await page.goto('/connections');
    const wizard = page.getByRole('list', { name: 'Connect MetaTrader 5' });
    await expect(page.locator('[data-connector-state="not_paired"]').first()).toBeVisible();

    // Stage 3: pairing code from the website, used once by the connector.
    await wizard.getByRole('button', { name: 'Create pairing code' }).click();
    const code = (await wizard.getByLabel('Pairing code').textContent())!.trim();
    expect(code).toMatch(/^[0-9A-F]{4}(-[0-9A-F]{4}){4}$/);
    await expect(wizard.getByText(new RegExp(`tradepilot-connector\\.cmd pair --api-url ${baseURL!.replace(/[.:/]/g, '\\$&')} --code ${code}`))).toBeVisible();

    controlDir = mkdtempSync(join(tmpdir(), 'tp-e2e-mt5-'));
    fixture = spawn(process.env.PYTHON ?? 'python3', ['connector/tests/e2e_fixture_session.py', '--api-url', baseURL!, '--code', code, '--control-dir', controlDir], {
      stdio: 'ignore',
    });

    // Stage 4: "Demo verified" appears only after the connector's authenticated report.
    await expect(page.getByText(/Demo verified/).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('•••• 821').first()).toBeVisible();
    await expect(page.getByText('TradePilot-TEST-FIXTURE').first()).toBeVisible();

    // Stage 5: choose a symbol from the broker list (real names, including suffixes).
    const symbols = page.getByRole('list', { name: 'Broker symbols' });
    await expect(symbols).toBeVisible({ timeout: 30_000 });
    await symbols.getByRole('checkbox', { name: /EURUSD\.r/ }).check();
    await page.getByRole('button', { name: 'Save 1 symbol' }).click();
    await expect(page.locator('[data-connector-state="connected"]').first()).toBeVisible({ timeout: 30_000 });

    // Dashboard: real account values in EUR and quotes that change only when new ticks arrive.
    await page.goto('/');
    const market = page.getByRole('region', { name: /Demo account & market/ });
    await expect(market.getByText('€10,012.34').first()).toBeVisible({ timeout: 30_000 });
    const quotes = market.getByRole('region', { name: 'Latest prices from your MT5 terminal' });
    const bidCell = quotes.getByRole('row').nth(1).getByRole('cell').nth(1);
    await expect(bidCell).toHaveText(/^1\.084\d\d$/, { timeout: 45_000 });
    const first = await bidCell.textContent();
    await expect(bidCell).not.toHaveText(first!, { timeout: 15_000 }); // a new tick arrived through the pipeline
    await expect(market.locator('[data-freshness="live"]').first()).toBeVisible();

    // A genuine price chart from stored bars (history requested through the task queue).
    await expect(market.locator('.recharts-line-curve').first()).toBeVisible({ timeout: 45_000 });
    await expect(market.getByText(/M5 closing prices from MT5’s own history/)).toBeVisible();

    // No new ticks: the price stops moving and is marked not current after a minute.
    writeFileSync(join(controlDir, 'freeze'), '1');
    await page.waitForTimeout(3_000);
    const frozen = await bidCell.textContent();
    await page.waitForTimeout(4_000);
    await expect(bidCell).toHaveText(frozen!);
    await expect(market.locator('[data-freshness="stale"]').first()).toBeVisible({ timeout: 75_000 });

    // Disconnect stops the feed; reconnect requires verification again.
    await page.goto('/connections');
    await wizard.getByRole('button', { name: /^Step 7: Disconnect/ }).click();
    await wizard.getByRole('button', { name: 'Disconnect data feed' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Disconnect' }).click();
    await expect(page.locator('[data-connector-state="disconnected"]').first()).toBeVisible({ timeout: 15_000 });
    await wizard.getByRole('button', { name: 'Reconnect' }).click();
    await expect(page.locator('[data-connector-state="connected"]').first()).toBeVisible({ timeout: 45_000 });

    // The terminal switches to a REAL account: blocked, never "Demo verified".
    writeFileSync(join(controlDir, 'real-account'), '1');
    await expect(page.locator('[data-connector-state="blocked_account_type"]').first()).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText(/Demo verified/)).toHaveCount(0);
    expect(violations).toEqual([]);
  });

  test('connected dashboard fits a phone screen with reduced motion', async ({ page, baseURL }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 390, height: 844 });
    const email = await createOwner('pages-mt5-mobile');
    await signIn(page, email);
    await page.goto('/connections');
    await page.getByRole('button', { name: 'Create pairing code' }).click();
    const code = (await page.getByLabel('Pairing code').textContent())!.trim();
    controlDir = mkdtempSync(join(tmpdir(), 'tp-e2e-mt5m-'));
    fixture = spawn(process.env.PYTHON ?? 'python3', ['connector/tests/e2e_fixture_session.py', '--api-url', baseURL!, '--code', code, '--control-dir', controlDir], { stdio: 'ignore' });
    await expect(page.getByText(/Demo verified/).first()).toBeVisible({ timeout: 30_000 });
    await page.goto('/');
    await expect(page.getByRole('region', { name: /Demo account & market/ }).getByText('€10,012.34').first()).toBeVisible({ timeout: 30_000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });
});
