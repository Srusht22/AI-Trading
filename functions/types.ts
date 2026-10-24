/** The subset of the Cloudflare Pages Functions context these handlers use. */
export interface PagesContext<Env> {
  request: Request;
  env: Env;
  params: Record<string, string | string[]>;
  next: () => Promise<Response>;
}
