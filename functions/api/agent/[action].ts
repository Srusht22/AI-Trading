import { handleAgentRequest } from '../../../server/agentApi';
import type { ServerEnv } from '../../../server/env';
import type { PagesContext } from '../../types';

export const onRequest = (ctx: PagesContext<ServerEnv>) =>
  handleAgentRequest(ctx.request, ctx.env, String(ctx.params.action ?? ''));
