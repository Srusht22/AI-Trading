import { applyApiMiddleware } from '../server/middleware';
import type { ServerEnv } from '../server/env';
import type { PagesContext } from './types';

export const onRequest = (ctx: PagesContext<ServerEnv>) => applyApiMiddleware(ctx.request, ctx.env, ctx.next);
