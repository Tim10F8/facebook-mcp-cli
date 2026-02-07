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

// --- Batch API ---

const BATCH_LIMIT = 50;

export interface BatchRequest {
  method: string;
  relative_url: string;
  body?: Record<string, string>;
}

export interface BatchResponse {
  code: number;
  body: any;
}

/**
 * Execute multiple Graph API calls in a single HTTP request.
 * Auto-chunks into groups of 50 (Facebook's batch limit).
 * Body params are URL-encoded as required by the batch API.
 */
export async function graphApiBatch(
  token: string,
  requests: BatchRequest[],
): Promise<BatchResponse[]> {
  if (requests.length === 0) return [];

  const results: BatchResponse[] = [];
  for (let i = 0; i < requests.length; i += BATCH_LIMIT) {
    const chunk = requests.slice(i, i + BATCH_LIMIT);
    const batch = chunk.map((r) => {
      const item: Record<string, string> = {
        method: r.method,
        relative_url: r.relative_url,
      };
      if (r.body) {
        item.body = new URLSearchParams(r.body).toString();
      }
      return item;
    });

    const url = new URL(GRAPH_API_BASE);
    url.searchParams.set("access_token", token);
    url.searchParams.set("include_headers", "false");
    url.searchParams.set("batch", JSON.stringify(batch));

    const res = await fetch(url.toString(), { method: "POST" });
    const raw: Array<{ code: number; body: string } | null> = await res.json();

    for (const item of raw) {
      if (item === null) {
        results.push({ code: 0, body: { error: "Request timed out in batch" } });
      } else {
        let parsed: any;
        try {
          parsed = JSON.parse(item.body);
        } catch {
          parsed = item.body;
        }
        results.push({ code: item.code, body: parsed });
      }
    }
  }
  return results;
}
