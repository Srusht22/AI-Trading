// Test suites create users and reassign the owner. Refuse to run them against
// anything but a local stack unless explicitly allowed.
export function assertLocalTarget(url) {
  const host = new URL(url).hostname;
  if (!['localhost', '127.0.0.1', '::1'].includes(host) && process.env.ALLOW_REMOTE_TESTS !== '1') {
    throw new Error(`Refusing to run tests against ${host}: they create users and change ownership. Use a local stack (npm run db:start).`);
  }
}
