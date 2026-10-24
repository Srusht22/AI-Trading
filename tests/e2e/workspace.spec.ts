import { expect, test } from '@playwright/test';
import { admin, createOwner, emailLink, noHorizontalOverflow, PASSWORD, signIn, uniqueEmail } from './helpers';

test.describe('authentication and access', () => {
  test('a signed-out visitor opening a private URL is sent to sign-in and sees no workspace', async ({ page }) => {
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fsettings$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Primary' })).toHaveCount(0);
  });

  test('sign up → confirm email → blocked until the trusted owner bootstrap → workspace', async ({ page }) => {
    const email = uniqueEmail('journey');
    await page.goto('/sign-up');
    await page.getByLabel('Display name').fill('Journey Tester');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();

    // Open the real confirmation email's link in the same browser (PKCE).
    await page.goto(await emailLink(email));
    await expect(page.getByRole('heading', { name: 'Finish setting up your workspace' }).or(page.getByRole('heading', { name: 'This is a private workspace' }))).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Primary' })).toHaveCount(0);

    // Owner access can only come from trusted server-side tooling.
    const { error } = await admin.rpc('admin_assign_owner', { p_email: email, p_replace: true });
    expect(error).toBeNull();
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: /Journey Tester\. Welcome to TradePilot AI/ })).toBeVisible();
    await expect(page.getByText('Account created')).toBeVisible();
  });

  test('wrong password is rejected with a clear message', async ({ page }) => {
    const email = await createOwner('badpw');
    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill('Not-The-Password-1');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toHaveText('The email or password is incorrect.');
  });

  test('signing out removes access, including via the back button', async ({ page }) => {
    const email = await createOwner('signout');
    await signIn(page, email);
    await page.goto('/settings');
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    await page.getByRole('button', { name: 'Personal workspace menu' }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/sign-in/);
    await page.goBack();
    await expect(page).toHaveURL(/\/sign-in/);
    await expect(page.getByText('Display currency')).toHaveCount(0);
  });

  test('password reset through the emailed link', async ({ page }) => {
    const email = await createOwner('reset');
    await page.goto('/forgot-password');
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByText(/If an account exists for that email/)).toBeVisible();

    await page.goto(await emailLink(email));
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
    const newPassword = 'Brand-New-Pass-77';
    await page.getByLabel('New password', { exact: true }).fill(newPassword);
    await page.getByLabel('Confirm new password').fill(newPassword);
    await page.getByRole('button', { name: 'Save new password' }).click();
    await expect(page).toHaveURL(/\/sign-in\?reset=1/);
    await expect(page.getByText('Your password was updated.')).toBeVisible();
    await signIn(page, email, newPassword);
  });
});

test.describe('persistence', () => {
  test('settings are stored in the database and survive a reload', async ({ page }) => {
    const email = await createOwner('settings');
    await signIn(page, email);
    await page.goto('/settings');
    await page.getByLabel('Display currency').selectOption('EUR');
    await page.getByLabel('Display timezone').selectOption('Europe/London');
    await expect(page.getByText('2 unsaved changes')).toBeVisible();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Settings saved')).toBeVisible();

    await page.reload();
    await expect(page.getByLabel('Display currency')).toHaveValue('EUR');
    await expect(page.getByLabel('Display timezone')).toHaveValue('Europe/London');

    // Verify at the source: the row really changed in Postgres.
    const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 });
    const id = users.users.find((u) => u.email === email)!.id;
    const { data } = await admin.from('user_settings').select('display_currency, timezone, revision').eq('user_id', id).single();
    expect(data).toMatchObject({ display_currency: 'EUR', timezone: 'Europe/London', revision: 2 });
  });

  test('the theme is saved to the account and restored after reload', async ({ page }) => {
    const email = await createOwner('theme');
    await signIn(page, email);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('button', { name: 'Switch to light theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    // Clear the device cache so only the database can restore it.
    await page.waitForTimeout(500);
    await page.evaluate(() => localStorage.removeItem('tp-theme'));
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test('a profile change appears in the security activity log', async ({ page }) => {
    const email = await createOwner('profile');
    await signIn(page, email);
    await page.goto('/account');
    await page.getByLabel('Display name').fill('Renamed Owner');
    await page.getByRole('button', { name: 'Save profile' }).click();
    await expect(page.getByText('Profile saved')).toBeVisible();
    await expect(page.getByText('Changed: display name.').first()).toBeVisible();
  });

  test('settings changed in another tab appear without a reload (Realtime)', async ({ page, context }) => {
    const email = await createOwner('realtime');
    await signIn(page, email);
    await page.goto('/settings');
    await expect(page.getByText('Live', { exact: true })).toBeVisible();
    const other = await context.newPage();
    await other.goto('/settings');
    await other.getByLabel('Display currency').selectOption('GBP');
    await other.getByRole('button', { name: 'Save changes' }).click();
    await expect(other.getByText('Settings saved')).toBeVisible();
    await expect(page.getByLabel('Display currency')).toHaveValue('GBP');
  });
});

test.describe('honest data', () => {
  test('the dashboard shows unavailable trading data, not invented numbers', async ({ page }) => {
    const email = await createOwner('honest');
    await signIn(page, email);
    await expect(page.getByText('This is your real workspace')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'No account connected' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'MetaTrader 5 is not connected' })).toBeVisible();
    await expect(page.locator('.recharts-area-curve')).toHaveCount(0);
    expect(await page.locator('main').innerText()).not.toMatch(/\$\d/);
  });
});

test.describe('responsive @mobile', () => {
  test('sign-in and dashboard fit a phone screen @mobile', async ({ page }) => {
    await page.goto('/sign-in');
    expect(await noHorizontalOverflow(page)).toBeLessThanOrEqual(0);
    const email = await createOwner('mobile');
    await signIn(page, email);
    expect(await noHorizontalOverflow(page)).toBeLessThanOrEqual(0);
    await page.goto('/settings');
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    expect(await noHorizontalOverflow(page)).toBeLessThanOrEqual(0);
  });
});
