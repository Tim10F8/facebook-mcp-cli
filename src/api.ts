/**
 * Facebook Graph API HTTP wrapper.
 * Single function for all Graph API calls — mirrors the Python FacebookAPI._request() pattern.
 */

import { GRAPH_API_BASE, GRAPH_API_VERSION } from "./config.js";

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

// --- Rupload API (Reels & Stories) ---

const RUPLOAD_BASE = `https://rupload.facebook.com/video-upload/${GRAPH_API_VERSION}`;

/**
 * Upload to rupload.facebook.com for Reels and Stories.
 * Uses Authorization header (not query param) and supports binary body or file_url header.
 */
export async function ruploadApi(
  endpoint: string,
  token: string,
  headers?: Record<string, string>,
  body?: Uint8Array,
): Promise<any> {
  const url = endpoint.startsWith("http") ? endpoint : `${RUPLOAD_BASE}/${endpoint}`;
  const hdrs: Record<string, string> = {
    Authorization: `OAuth ${token}`,
    ...headers,
  };
  const opts: RequestInit = { method: "POST", headers: hdrs };
  if (body) {
    opts.body = body;
  }
  const res = await fetch(url, opts);
  return res.json();
}

// --- Resumable Upload API (generic video publishing with local files) ---

/**
 * Upload a local file via Facebook's Resumable Upload API.
 * 2-step: init upload session → transfer binary.
 * Returns the file handle string for use in publish calls.
 */
export async function resumableUpload(
  appId: string,
  userToken: string,
  fileData: Uint8Array,
  fileName: string,
  fileSize: number,
  fileType: string,
): Promise<string> {
  // Step 1: Init upload session
  const initRes = await graphApi("POST", `${appId}/uploads`, userToken, {
    file_name: fileName,
    file_length: String(fileSize),
    file_type: fileType,
  });
  const sessionId = initRes.id; // format: "upload:XXXX"

  // Step 2: Transfer binary
  const uploadUrl = `${GRAPH_API_BASE}/${sessionId}`;
  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `OAuth ${userToken}`,
      file_offset: "0",
      "Content-Type": "application/octet-stream",
    },
    body: fileData,
  });
  const result = await res.json();
  return result.h; // file handle
}
