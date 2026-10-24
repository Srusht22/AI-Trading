import { z } from 'zod';

// zod 4 probes `new Function()` to JIT-compile object parsers. That is an
// eval sink: under our CSP (no 'unsafe-eval', Trusted Types required) it is
// blocked and reported as a violation, and Cloudflare Workers forbid it too.
// The interpreter path is fast enough for our payloads.
z.config({ jitless: true });
