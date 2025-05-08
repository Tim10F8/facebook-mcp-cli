/**
 * Facebook Graph API HTTP wrapper.
 * Single function for all Graph API calls — mirrors the Python FacebookAPI._request() pattern.
 */

import { GRAPH_API_BASE } from "./config.js";

export async function graphApi(
  method: string,
  endpoint: string,
  token: string,
  params?: Record<string, string>,
  body?: Record<string, unknown>,
): Promise<any> {
  const url = new URL(`${GRAPH_API_BASE}/${endpoint}`);
  url.searchParams.set("access_token", token);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }
  const opts: RequestInit = { method };
  if (body) {
    opts.headers = { "Content-Type": "application/json" };
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url.toString(), opts);
  return res.json();
}
