import { handleHealthRequest } from '../../server/healthApi';
import type { ServerEnv } from '../../server/env';
import type { PagesContext } from '../types';

export const onRequest = (ctx: PagesContext<ServerEnv>) => handleHealthRequest(ctx.request, ctx.env);
