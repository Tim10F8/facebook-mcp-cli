#!/usr/bin/env bun
/**
 * fbcli — Facebook Page Management CLI
 * Standalone shell interface to the Facebook Graph API.
 * Reads FACEBOOK_ASSETS from .env in the fbcli directory.
 */

import { readFileSync, existsSync } from "fs";
import { dirname, join } from "path";

const VERSION = "2.0.0";
const GRAPH_API_BASE = "https://graph.facebook.com/v22.0";
const SCRIPT_DIR = dirname(Bun.main);
const ENV_PATH = join(SCRIPT_DIR, ".env");

// --- Debug logging (stderr, only when DEBUG=1) ---

const DEBUG = !!process.env.DEBUG;

function debug(label: string, ...args: unknown[]) {
  if (DEBUG) console.error(`[fbcli:${label}]`, ...args);
}

function isError(res: unknown): boolean {
  return typeof res === "object" && res !== null && "error" in res;
}

// --- Config ---

interface PageAsset {
  fb_page_id: string;
  page_name: string;
  display_name: string;
  page_access_token: string;
}

function loadAssets(): PageAsset[] {
  if (!existsSync(ENV_PATH)) {
    die(`Config not found: ${ENV_PATH}\nCreate .env with FACEBOOK_ASSETS in the fbcli directory.`);
  }
  const text = readFileSync(ENV_PATH, "utf-8");
  const match = text.match(/^FACEBOOK_ASSETS\s*=\s*'(.+)'$/m)
    ?? text.match(/^FACEBOOK_ASSETS\s*=\s*"(.+)"$/m)
    ?? text.match(/^FACEBOOK_ASSETS\s*=\s*(.+)$/m);
  if (!match) die("FACEBOOK_ASSETS not found in " + ENV_PATH);
  try {
    return JSON.parse(match[1]);
  } catch {
    die("FACEBOOK_ASSETS is not valid JSON");
  }
}

function loadAppConfig(): { appId?: string; userToken?: string } {
  if (!existsSync(ENV_PATH)) return {};
  const text = readFileSync(ENV_PATH, "utf-8");
  const appMatch = text.match(/^FB_APP_ID\s*=\s*['"]?([^'"\n]+)['"]?$/m);
  const tokenMatch = text.match(/^FB_USER_ACCESS_TOKEN\s*=\s*['"]?([^'"\n]+)['"]?$/m);
  return {
    appId: appMatch?.[1],
    userToken: tokenMatch?.[1],
  };
}

function getPage(assets: PageAsset[], name: string): PageAsset {
  const page = assets.find((a) => a.page_name === name);
  if (!page) {
    const available = assets.map((a) => a.page_name).join(", ") || "(none)";
    die(`Page '${name}' not found. Available: ${available}`);
  }
  return page;
}

// --- Graph API ---

async function graphApi(
  method: string,
  endpoint: string,
  token: string,
  params?: Record<string, string>,
  body?: Record<string, unknown>
): Promise<unknown> {
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
  debug("graph", method, endpoint);
  const res = await fetch(url.toString(), opts);
  return res.json();
}

// --- Batch API ---

const BATCH_LIMIT = 50;

interface BatchRequest {
  method: string;
  relative_url: string;
  body?: Record<string, string>;
}

interface BatchResponse {
  code: number;
  body: any;
}

async function graphApiBatch(
  token: string,
  requests: BatchRequest[]
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

// --- Rupload / File Helpers ---

const GRAPH_API_VERSION = "v22.0";
const RUPLOAD_BASE = `https://rupload.facebook.com/video-upload/${GRAPH_API_VERSION}`;

async function ruploadApi(
  endpoint: string,
  token: string,
  headers?: Record<string, string>,
  body?: Uint8Array,
): Promise<unknown> {
  const url = endpoint.startsWith("http") ? endpoint : `${RUPLOAD_BASE}/${endpoint}`;
  const hdrs: Record<string, string> = {
    Authorization: `OAuth ${token}`,
    ...headers,
  };
  const opts: RequestInit = { method: "POST", headers: hdrs };
  if (body) opts.body = body;
  debug("rupload", endpoint);
  const res = await fetch(url, opts);
  return res.json();
}

async function resumableUpload(
  appId: string,
  userToken: string,
  fileData: Uint8Array,
  fileName: string,
  fileSize: number,
  fileType: string,
): Promise<any> {
  debug("upload:init", appId, fileName, fileSize);
  const initRes = (await graphApi("POST", `${appId}/uploads`, userToken, {
    file_name: fileName,
    file_length: String(fileSize),
    file_type: fileType,
  })) as Record<string, any>;
  if (isError(initRes)) return initRes;
  const sessionId = initRes.id;

  debug("upload:transfer", sessionId);
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
  const result = (await res.json()) as Record<string, any>;
  return result.h;
}

function isUrl(str: string): boolean {
  return str.startsWith("http://") || str.startsWith("https://");
}

async function readLocalFile(path: string): Promise<{ data: Uint8Array; size: number; name: string }> {
  const file = Bun.file(path);
  if (!(await file.exists())) die(`File not found: ${path}`);
  const data = new Uint8Array(await file.arrayBuffer());
  const name = path.split("/").pop() ?? "video.mp4";
  return { data, size: data.length, name };
}

// --- Helpers ---

function die(msg: string): never {
  console.error(`fbcli: ${msg}`);
  process.exit(1);
}

function out(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

function requireArgs(args: string[], count: number, usage: string): void {
  if (args.length < count) die(`Usage: fbcli ${usage}`);
}

/** Read all of stdin as a trimmed string. Returns null if stdin is a TTY. */
async function readStdin(): Promise<string | null> {
  if (process.stdin.isTTY) return null;
  const text = await Bun.stdin.text();
  return text.trim() || null;
}

/**
 * Resolve a text argument: use the provided arg, or fall back to stdin.
 * Pass "-" explicitly to force stdin reading.
 */
async function resolveText(arg: string | undefined, label: string): Promise<string> {
  if (arg !== undefined && arg !== "-") return arg;
  const stdin = await readStdin();
  if (!stdin) die(`No ${label} provided via argument or stdin.`);
  return stdin;
}

/**
 * Resolve a comma-separated ID list: use the provided arg, or fall back to stdin.
 * Stdin can be comma-separated, newline-separated, or both.
 */
async function resolveIds(arg: string | undefined): Promise<string> {
  if (arg !== undefined && arg !== "-") return arg;
  const stdin = await readStdin();
  if (!stdin) die("No IDs provided via argument or stdin.");
  // Normalize: split on commas and newlines, filter blanks, rejoin
  return stdin.split(/[,\n]+/).map(s => s.trim()).filter(Boolean).join(",");
}

// --- Commands ---

async function cmdPages(assets: PageAsset[]) {
  out(
    assets.map((a) => ({
      page_name: a.page_name,
      display_name: a.display_name,
      fb_page_id: a.fb_page_id,
    }))
  );
}

async function cmdPosts(page: PageAsset) {
  out(await graphApi("GET", `${page.fb_page_id}/posts`, page.page_access_token, {
    fields: "id,message,created_time",
  }));
}

async function cmdPost(page: PageAsset, message: string) {
  out(await graphApi("POST", `${page.fb_page_id}/feed`, page.page_access_token, {
    message,
  }));
}

async function cmdPostImage(page: PageAsset, imageUrl: string, caption: string) {
  out(await graphApi("POST", `${page.fb_page_id}/photos`, page.page_access_token, {
    url: imageUrl,
    caption,
  }));
}

async function cmdUpdatePost(page: PageAsset, postId: string, message: string) {
  out(await graphApi("POST", postId, page.page_access_token, { message }));
}

async function cmdDeletePost(page: PageAsset, postId: string) {
  out(await graphApi("DELETE", postId, page.page_access_token));
}

async function cmdSchedule(page: PageAsset, message: string, timestamp: string) {
  out(await graphApi("POST", `${page.fb_page_id}/feed`, page.page_access_token, {
    message,
    published: "false",
    scheduled_publish_time: timestamp,
  }));
}

async function cmdComments(page: PageAsset, postId: string) {
  out(await graphApi("GET", `${postId}/comments`, page.page_access_token, {
    fields: "id,message,from,created_time",
  }));
}

async function cmdReply(page: PageAsset, commentId: string, message: string) {
  out(await graphApi("POST", `${commentId}/comments`, page.page_access_token, {
    message,
  }));
}

async function cmdDeleteComment(page: PageAsset, commentId: string) {
  out(await graphApi("DELETE", commentId, page.page_access_token));
}

async function cmdHideComment(page: PageAsset, commentId: string) {
  out(await graphApi("POST", commentId, page.page_access_token, {
    is_hidden: "true",
  }));
}

async function cmdUnhideComment(page: PageAsset, commentId: string) {
  out(await graphApi("POST", commentId, page.page_access_token, {
    is_hidden: "false",
  }));
}

async function cmdBulkDelete(page: PageAsset, ids: string) {
  const commentIds = ids.split(",").map((s) => s.trim()).filter(Boolean);
  const requests = commentIds.map((cid) => ({
    method: "DELETE",
    relative_url: cid,
  }));
  const responses = await graphApiBatch(page.page_access_token, requests);
  out(
    commentIds.map((cid, i) => ({
      comment_id: cid,
      result: responses[i].body,
      success: responses[i].code === 200,
    })),
  );
}

async function cmdBulkHide(page: PageAsset, ids: string) {
  const commentIds = ids.split(",").map((s) => s.trim()).filter(Boolean);
  const requests = commentIds.map((cid) => ({
    method: "POST",
    relative_url: cid,
    body: { is_hidden: "true" },
  }));
  const responses = await graphApiBatch(page.page_access_token, requests);
  out(
    commentIds.map((cid, i) => ({
      comment_id: cid,
      result: responses[i].body,
      success: responses[i].code === 200,
    })),
  );
}

async function cmdInsights(page: PageAsset, postId: string) {
  const metrics = [
    "post_impressions",
    "post_impressions_unique",
    "post_impressions_paid",
    "post_impressions_organic",
    "post_engaged_users",
    "post_clicks",
    "post_reactions_like_total",
    "post_reactions_love_total",
    "post_reactions_wow_total",
    "post_reactions_haha_total",
    "post_reactions_sorry_total",
    "post_reactions_anger_total",
  ];
  out(await graphApi("GET", `${postId}/insights`, page.page_access_token, {
    metric: metrics.join(","),
    period: "lifetime",
  }));
}

async function cmdFans(page: PageAsset) {
  const data = (await graphApi("GET", page.fb_page_id, page.page_access_token, {
    fields: "fan_count",
  })) as Record<string, unknown>;
  out({ fan_count: data.fan_count ?? 0 });
}

async function cmdLikes(page: PageAsset, postId: string) {
  const data = (await graphApi("GET", postId, page.page_access_token, {
    fields: "likes.summary(true)",
  })) as Record<string, any>;
  out({ likes: data.likes?.summary?.total_count ?? 0 });
}

async function cmdShares(page: PageAsset, postId: string) {
  const data = (await graphApi("GET", postId, page.page_access_token, {
    fields: "shares",
  })) as Record<string, any>;
  out({ shares: data.shares?.count ?? 0 });
}

async function cmdReactions(page: PageAsset, postId: string) {
  const metrics = [
    "post_reactions_like_total",
    "post_reactions_love_total",
    "post_reactions_wow_total",
    "post_reactions_haha_total",
    "post_reactions_sorry_total",
    "post_reactions_anger_total",
  ];
  const raw = (await graphApi("GET", `${postId}/insights`, page.page_access_token, {
    metric: metrics.join(","),
    period: "lifetime",
  })) as Record<string, any>;
  const results: Record<string, unknown> = {};
  for (const item of raw.data ?? []) {
    results[item.name] = item.values?.[0]?.value;
  }
  out(results);
}

async function cmdImpressions(page: PageAsset, postId: string) {
  out(await graphApi("GET", `${postId}/insights`, page.page_access_token, {
    metric: "post_impressions",
    period: "lifetime",
  }));
}

async function cmdReach(page: PageAsset, postId: string) {
  out(await graphApi("GET", `${postId}/insights`, page.page_access_token, {
    metric: "post_impressions_unique",
    period: "lifetime",
  }));
}

async function cmdClicks(page: PageAsset, postId: string) {
  out(await graphApi("GET", `${postId}/insights`, page.page_access_token, {
    metric: "post_clicks",
    period: "lifetime",
  }));
}

async function cmdEngaged(page: PageAsset, postId: string) {
  out(await graphApi("GET", `${postId}/insights`, page.page_access_token, {
    metric: "post_engaged_users",
    period: "lifetime",
  }));
}

async function cmdTopCommenters(page: PageAsset, postId: string) {
  const data = (await graphApi("GET", `${postId}/comments`, page.page_access_token, {
    fields: "id,message,from,created_time",
  })) as Record<string, any>;
  const counter: Record<string, number> = {};
  for (const comment of data.data ?? []) {
    const userId = comment.from?.id;
    if (userId) counter[userId] = (counter[userId] ?? 0) + 1;
  }
  const sorted = Object.entries(counter)
    .map(([user_id, count]) => ({ user_id, count }))
    .sort((a, b) => b.count - a.count);
  out(sorted);
}

async function cmdCommentCount(page: PageAsset, postId: string) {
  const data = (await graphApi("GET", `${postId}/comments`, page.page_access_token, {
    fields: "id",
  })) as Record<string, any>;
  out({ comment_count: (data.data ?? []).length });
}

async function cmdDm(page: PageAsset, userId: string, message: string) {
  out(
    await graphApi("POST", "me/messages", page.page_access_token, undefined, {
      recipient: { id: userId },
      message: { text: message },
      messaging_type: "RESPONSE",
    })
  );
}

// --- Video Commands ---

async function cmdPublishReel(page: PageAsset, source: string, description?: string, title?: string) {
  const token = page.page_access_token;
  // Step 1: Init
  debug("reel", "init", page.fb_page_id);
  const init = (await graphApi("POST", `${page.fb_page_id}/video_reels`, token, {
    upload_phase: "start",
  })) as Record<string, any>;
  if (isError(init)) { out({ step: "init", ...init }); return; }
  const videoId = init.video_id;

  // Step 2: Upload
  debug("reel", "upload", videoId);
  let upload: unknown;
  if (isUrl(source)) {
    upload = await ruploadApi(videoId, token, { file_url: source });
  } else {
    const { data, size } = await readLocalFile(source);
    upload = await ruploadApi(videoId, token, {
      offset: "0",
      file_size: String(size),
    }, data);
  }
  if (isError(upload)) { out({ step: "upload", video_id: videoId, ...(upload as object) }); return; }

  // Step 3: Publish
  debug("reel", "publish", videoId);
  const finishParams: Record<string, string> = {
    upload_phase: "finish",
    video_id: videoId,
    video_state: "PUBLISHED",
  };
  if (description) finishParams.description = description;
  if (title) finishParams.title = title;
  const result = await graphApi("POST", `${page.fb_page_id}/video_reels`, token, finishParams);
  if (isError(result)) { out({ step: "publish", video_id: videoId, ...(result as object) }); return; }
  out(result);
}

async function cmdReels(page: PageAsset) {
  out(await graphApi("GET", `${page.fb_page_id}/video_reels`, page.page_access_token));
}

async function cmdVideoStatus(page: PageAsset, videoId: string) {
  out(await graphApi("GET", videoId, page.page_access_token, { fields: "status" }));
}

async function cmdVideoStory(page: PageAsset, source: string) {
  const token = page.page_access_token;
  debug("video-story", "init", page.fb_page_id);
  const init = (await graphApi("POST", `${page.fb_page_id}/video_stories`, token, {
    upload_phase: "start",
  })) as Record<string, any>;
  if (isError(init)) { out({ step: "init", ...init }); return; }
  const videoId = init.video_id;

  debug("video-story", "upload", videoId);
  let upload: unknown;
  if (isUrl(source)) {
    upload = await ruploadApi(videoId, token, { file_url: source });
  } else {
    const { data, size } = await readLocalFile(source);
    upload = await ruploadApi(videoId, token, {
      offset: "0",
      file_size: String(size),
    }, data);
  }
  if (isError(upload)) { out({ step: "upload", video_id: videoId, ...(upload as object) }); return; }

  debug("video-story", "publish", videoId);
  const result = await graphApi("POST", `${page.fb_page_id}/video_stories`, token, {
    upload_phase: "finish",
    video_id: videoId,
  });
  if (isError(result)) { out({ step: "publish", video_id: videoId, ...(result as object) }); return; }
  out(result);
}

async function cmdPhotoStory(page: PageAsset, photoUrl: string) {
  const token = page.page_access_token;
  debug("photo-story", "upload", page.fb_page_id);
  const upload = (await graphApi("POST", `${page.fb_page_id}/photos`, token, {
    url: photoUrl,
    published: "false",
  })) as Record<string, any>;
  if (isError(upload)) { out({ step: "upload", ...upload }); return; }
  const photoId = upload.id;

  debug("photo-story", "publish", photoId);
  const result = await graphApi("POST", `${page.fb_page_id}/photo_stories`, token, {
    photo_id: photoId,
  });
  if (isError(result)) { out({ step: "publish", photo_id: photoId, ...(result as object) }); return; }
  out(result);
}

async function cmdStories(page: PageAsset) {
  out(await graphApi("GET", `${page.fb_page_id}/stories`, page.page_access_token));
}

async function cmdSlideshow(page: PageAsset, imageUrls: string[], durationMs: number, transitionMs: number) {
  out(await graphApi("POST", `${page.fb_page_id}/videos`, page.page_access_token, {
    slideshow_spec: JSON.stringify({
      images_urls: imageUrls,
      duration_ms: durationMs,
      transition_ms: transitionMs,
    }),
  }));
}

async function cmdPublishVideo(page: PageAsset, source: string, title?: string, description?: string) {
  const token = page.page_access_token;
  if (isUrl(source)) {
    const params: Record<string, string> = { file_url: source };
    if (title) params.title = title;
    if (description) params.description = description;
    out(await graphApi("POST", `${page.fb_page_id}/videos`, token, params));
  } else {
    const config = loadAppConfig();
    if (!config.appId || !config.userToken) {
      die("Local file upload requires FB_APP_ID and FB_USER_ACCESS_TOKEN in .env");
    }
    const { data, size, name } = await readLocalFile(source);
    const handle = await resumableUpload(config.appId, config.userToken, data, name, size, "video/mp4");
    const params: Record<string, string> = { file_url: handle };
    if (title) params.title = title;
    if (description) params.description = description;
    out(await graphApi("POST", `${page.fb_page_id}/videos`, token, params));
  }
}

async function cmdMusic(type: string, countries?: string) {
  const assets = loadAssets();
  if (assets.length === 0) die("No pages configured — need a token for music API");
  const token = assets[0].page_access_token;
  const params: Record<string, string> = { type };
  if (countries) params.countries = countries;
  out(await graphApi("GET", "audio/recommendations", token, params));
}

async function cmdCrosspost(page: PageAsset, videoId: string) {
  out(await graphApi("POST", `${page.fb_page_id}/videos`, page.page_access_token, {
    crossposted_video_id: videoId,
  }));
}

async function cmdEnableCrosspost(page: PageAsset, videoId: string, targetPageIds: string[]) {
  out(await graphApi("POST", videoId, page.page_access_token, undefined, {
    allow_crossposting_for_pages: targetPageIds,
  }));
}

async function cmdCrosspostPages(page: PageAsset) {
  out(await graphApi("GET", `${page.fb_page_id}/crosspost_whitelisted_pages`, page.page_access_token));
}

async function cmdCrosspostCheck(page: PageAsset, videoId: string) {
  out(await graphApi("GET", videoId, page.page_access_token, {
    fields: "is_crossposting_eligible",
  }));
}

async function cmdAbCreate(
  page: PageAsset,
  name: string,
  goal: string,
  experimentVideoIds: string[],
  controlVideoId: string,
  description?: string,
  durationSeconds?: number,
) {
  const body: Record<string, unknown> = {
    name,
    experiment_video_ids: experimentVideoIds,
    control_video_id: controlVideoId,
    optimization_goal: goal,
  };
  if (description) body.description = description;
  if (durationSeconds) body.duration_seconds = durationSeconds;
  out(await graphApi("POST", `${page.fb_page_id}/ab_tests`, page.page_access_token, undefined, body));
}

async function cmdAbResults(page: PageAsset, testId: string) {
  out(await graphApi("GET", testId, page.page_access_token));
}

async function cmdAbTests(page: PageAsset, since?: string, until?: string) {
  const params: Record<string, string> = {};
  if (since) params.since = since;
  if (until) params.until = until;
  out(await graphApi("GET", `${page.fb_page_id}/ab_tests`, page.page_access_token, params));
}

async function cmdAbDelete(page: PageAsset, testId: string) {
  out(await graphApi("DELETE", testId, page.page_access_token));
}

// --- Help ---

const HELP = `fbcli v${VERSION} — Facebook Page Management CLI

USAGE
  fbcli <command> [args...]

GLOBAL FLAGS
  --help       Show this help
  --version    Show version

COMMANDS
  Pages
    pages                                List all configured pages

  Posts
    posts <page>                         List recent posts
    post <page> [message]                Create text post
    post-image <page> <url> [caption]    Post image with caption
    update-post <page> <post_id> [msg]   Update post message
    delete-post <page> <post_id>         Delete post
    schedule <page> [msg] <timestamp>    Schedule future post (Unix ts)

  Comments
    comments <page> <post_id>            List comments on post
    reply <page> <comment_id> [msg]      Reply to comment
    delete-comment <page> <comment_id>   Delete comment
    hide-comment <page> <comment_id>     Hide comment
    unhide-comment <page> <comment_id>   Unhide comment
    bulk-delete <page> [id1,id2,...]     Bulk delete comments
    bulk-hide <page> [id1,id2,...]       Bulk hide comments

  Analytics
    insights <page> <post_id>            All insights for post
    fans <page>                          Page fan count
    likes <page> <post_id>               Like count
    shares <page> <post_id>              Share count
    reactions <page> <post_id>           Reaction breakdown
    impressions <page> <post_id>         Total impressions
    reach <page> <post_id>               Unique impressions
    clicks <page> <post_id>              Click count
    engaged <page> <post_id>             Engaged users
    top-commenters <page> <post_id>      Top commenters
    comment-count <page> <post_id>       Comment count

  Messaging
    dm <page> <user_id> [message]        Send DM

  Video
    publish-reel <page> <url|file> [desc]  Publish Reel
    reels <page>                           List Reels
    video-status <page> <video_id>         Check processing status
    publish-video <page> <url|file> [title]  Publish video to feed

  Stories
    video-story <page> <url|file>          Publish video Story
    photo-story <page> <photo_url>         Publish photo Story
    stories <page>                         List Stories

  Slideshows
    slideshow <page> <urls,...>             Create slideshow (3-7 images)

  Music
    music [--type popular|new|foryou]       Music recommendations

  Crossposting
    crosspost <page> <video_id>            Crosspost video to page
    enable-crosspost <page> <vid> <pids>   Enable crossposting
    crosspost-pages <page>                 List eligible pages
    crosspost-check <page> <video_id>      Check eligibility

  A/B Testing
    ab-create <page> <name> <goal> <vids> <ctrl>  Create A/B test
    ab-results <page> <test_id>            Get test results
    ab-tests <page>                        List A/B tests
    ab-delete <page> <test_id>             Delete A/B test

STDIN SUPPORT
  Commands with [brackets] accept input via stdin when the argument is
  omitted or replaced with "-". This enables piping and composition:

    echo "Hello world!" | fbcli post mybusiness
    cat draft.txt | fbcli post mybusiness
    cat update.txt | fbcli update-post mybusiness 123_456
    echo "Thanks!" | fbcli reply mybusiness 123_789
    echo "Hi there" | fbcli dm mybusiness 9876543210
    cat message.txt | fbcli schedule mybusiness 1771069200

  Bulk commands accept newline-separated IDs from stdin:

    fbcli comments mybusiness 123_456 | jq -r '.data[].id' | fbcli bulk-hide mybusiness
    cat ids.txt | fbcli bulk-delete mybusiness

  Use "-" to explicitly read from stdin when other args are present:

    fbcli post mybusiness -

EXAMPLES
  # List configured pages
  fbcli pages

  # Create a text post
  fbcli post mybusiness "Check out our new product launch!"

  # Post from a file via stdin
  cat draft.txt | fbcli post mybusiness

  # Post an image with caption
  fbcli post-image mybusiness https://example.com/photo.jpg "Our team at the event"

  # Schedule a post for Feb 15 2026 at noon UTC
  fbcli schedule mybusiness "Coming soon!" 1771069200

  # Schedule with message from stdin
  cat announcement.txt | fbcli schedule mybusiness 1771069200

  # View comments on a post, then reply to one
  fbcli comments mybusiness 123456789_987654321
  fbcli reply mybusiness 123456789_111 "Thanks for the feedback!"

  # Hide multiple spam comments at once (comma-separated, no spaces)
  fbcli bulk-hide mybusiness 123_111,123_222,123_333

  # Bulk hide with IDs piped from another command
  fbcli comments mybusiness 123_456 | jq -r '.data[].id' | fbcli bulk-hide mybusiness

  # Get full analytics for a post
  fbcli insights mybusiness 123456789_987654321

  # Get reaction breakdown
  fbcli reactions mybusiness 123456789_987654321

  # Send a DM to a user
  fbcli dm mybusiness 1234567890 "Thanks for reaching out!"

  # Send DM with message from stdin
  echo "Thanks for reaching out!" | fbcli dm mybusiness 1234567890

  # Pipe to jq — extract post IDs
  fbcli posts mybusiness | jq '.data[].id'

  # Pipe to jq — fan count as plain number
  fbcli fans mybusiness | jq -r '.fan_count'

  # Shell loop — post to all configured pages
  for page in $(fbcli pages | jq -r '.[].page_name'); do
    fbcli post "$page" "Weekly update!"
  done

CONFIG
  Reads FACEBOOK_ASSETS from .env in the fbcli directory.
  Format: FACEBOOK_ASSETS='[{"fb_page_id":"...","page_name":"...","display_name":"...","page_access_token":"..."}]'

  Each entry requires:
    fb_page_id          Facebook Page ID
    page_name           Slug identifier (lowercase, no spaces) used as <page> arg
    display_name        Human-readable label shown by 'pages' command
    page_access_token   Page token from developers.facebook.com/tools/explorer

  Multiple pages supported — add more objects to the JSON array.

  Graph API version: v22.0
`;

// --- Main ---

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(HELP);
    return;
  }
  if (args.includes("--version") || args.includes("-v")) {
    console.log(VERSION);
    return;
  }

  const command = args[0];
  const rest = args.slice(1);

  if (command === "pages") {
    const assets = loadAssets();
    return cmdPages(assets);
  }

  // Music is a global endpoint — no page required
  if (command === "music") {
    const typeMap: Record<string, string> = {
      popular: "FACEBOOK_POPULAR_MUSIC",
      new: "FACEBOOK_NEW_MUSIC",
      foryou: "FACEBOOK_FOR_YOU",
    };
    const typeIdx = rest.indexOf("--type");
    const typeArg = typeIdx !== -1 && rest[typeIdx + 1] ? rest[typeIdx + 1] : "popular";
    const type = typeMap[typeArg] ?? typeArg;
    const countryIdx = rest.indexOf("--country");
    const countries = countryIdx !== -1 && rest[countryIdx + 1] ? rest[countryIdx + 1] : undefined;
    return cmdMusic(type, countries);
  }

  // All other commands need a page
  const assets = loadAssets();

  // Commands that take <page> as first arg
  const pageName = rest[0];
  const cmdArgs = rest.slice(1);

  switch (command) {
    // Posts
    case "posts":
      requireArgs(rest, 1, "posts <page>");
      return cmdPosts(getPage(assets, pageName));
    case "post": {
      requireArgs(rest, 1, "post <page> [message]  (or pipe message via stdin)");
      const msg = await resolveText(cmdArgs.length ? cmdArgs.join(" ") : undefined, "message");
      return cmdPost(getPage(assets, pageName), msg);
    }
    case "post-image": {
      requireArgs(rest, 2, "post-image <page> <url> [caption]  (or pipe caption via stdin)");
      const caption = await resolveText(
        cmdArgs.length > 1 ? cmdArgs.slice(1).join(" ") : undefined,
        "caption"
      );
      return cmdPostImage(getPage(assets, pageName), cmdArgs[0], caption);
    }
    case "update-post": {
      requireArgs(rest, 2, "update-post <page> <post_id> [message]  (or pipe message via stdin)");
      const msg = await resolveText(
        cmdArgs.length > 1 ? cmdArgs.slice(1).join(" ") : undefined,
        "message"
      );
      return cmdUpdatePost(getPage(assets, pageName), cmdArgs[0], msg);
    }
    case "delete-post":
      requireArgs(rest, 2, "delete-post <page> <post_id>");
      return cmdDeletePost(getPage(assets, pageName), cmdArgs[0]);
    case "schedule": {
      // schedule <page> <timestamp>  (message from stdin)
      // schedule <page> <message...> <timestamp>  (message from args)
      requireArgs(rest, 2, "schedule <page> [message] <timestamp>  (or pipe message via stdin)");
      const lastArg = cmdArgs[cmdArgs.length - 1];
      if (cmdArgs.length === 1) {
        // Only timestamp provided, message must come from stdin
        const msg = await resolveText(undefined, "message");
        return cmdSchedule(getPage(assets, pageName), msg, lastArg);
      }
      // Multiple args: last is timestamp, rest is message
      return cmdSchedule(
        getPage(assets, pageName),
        cmdArgs.slice(0, -1).join(" "),
        lastArg
      );
    }

    // Comments
    case "comments":
      requireArgs(rest, 2, "comments <page> <post_id>");
      return cmdComments(getPage(assets, pageName), cmdArgs[0]);
    case "reply": {
      requireArgs(rest, 2, "reply <page> <comment_id> [message]  (or pipe message via stdin)");
      const msg = await resolveText(
        cmdArgs.length > 1 ? cmdArgs.slice(1).join(" ") : undefined,
        "message"
      );
      return cmdReply(getPage(assets, pageName), cmdArgs[0], msg);
    }
    case "delete-comment":
      requireArgs(rest, 2, "delete-comment <page> <comment_id>");
      return cmdDeleteComment(getPage(assets, pageName), cmdArgs[0]);
    case "hide-comment":
      requireArgs(rest, 2, "hide-comment <page> <comment_id>");
      return cmdHideComment(getPage(assets, pageName), cmdArgs[0]);
    case "unhide-comment":
      requireArgs(rest, 2, "unhide-comment <page> <comment_id>");
      return cmdUnhideComment(getPage(assets, pageName), cmdArgs[0]);
    case "bulk-delete": {
      requireArgs(rest, 1, "bulk-delete <page> [id1,id2,...]  (or pipe IDs via stdin)");
      const ids = await resolveIds(cmdArgs[0]);
      return cmdBulkDelete(getPage(assets, pageName), ids);
    }
    case "bulk-hide": {
      requireArgs(rest, 1, "bulk-hide <page> [id1,id2,...]  (or pipe IDs via stdin)");
      const ids = await resolveIds(cmdArgs[0]);
      return cmdBulkHide(getPage(assets, pageName), ids);
    }

    // Analytics
    case "insights":
      requireArgs(rest, 2, "insights <page> <post_id>");
      return cmdInsights(getPage(assets, pageName), cmdArgs[0]);
    case "fans":
      requireArgs(rest, 1, "fans <page>");
      return cmdFans(getPage(assets, pageName));
    case "likes":
      requireArgs(rest, 2, "likes <page> <post_id>");
      return cmdLikes(getPage(assets, pageName), cmdArgs[0]);
    case "shares":
      requireArgs(rest, 2, "shares <page> <post_id>");
      return cmdShares(getPage(assets, pageName), cmdArgs[0]);
    case "reactions":
      requireArgs(rest, 2, "reactions <page> <post_id>");
      return cmdReactions(getPage(assets, pageName), cmdArgs[0]);
    case "impressions":
      requireArgs(rest, 2, "impressions <page> <post_id>");
      return cmdImpressions(getPage(assets, pageName), cmdArgs[0]);
    case "reach":
      requireArgs(rest, 2, "reach <page> <post_id>");
      return cmdReach(getPage(assets, pageName), cmdArgs[0]);
    case "clicks":
      requireArgs(rest, 2, "clicks <page> <post_id>");
      return cmdClicks(getPage(assets, pageName), cmdArgs[0]);
    case "engaged":
      requireArgs(rest, 2, "engaged <page> <post_id>");
      return cmdEngaged(getPage(assets, pageName), cmdArgs[0]);
    case "top-commenters":
      requireArgs(rest, 2, "top-commenters <page> <post_id>");
      return cmdTopCommenters(getPage(assets, pageName), cmdArgs[0]);
    case "comment-count":
      requireArgs(rest, 2, "comment-count <page> <post_id>");
      return cmdCommentCount(getPage(assets, pageName), cmdArgs[0]);

    // Messaging
    case "dm": {
      requireArgs(rest, 2, "dm <page> <user_id> [message]  (or pipe message via stdin)");
      const msg = await resolveText(
        cmdArgs.length > 1 ? cmdArgs.slice(1).join(" ") : undefined,
        "message"
      );
      return cmdDm(getPage(assets, pageName), cmdArgs[0], msg);
    }

    // Video
    case "publish-reel": {
      requireArgs(rest, 2, "publish-reel <page> <url|file> [description]");
      const desc = cmdArgs.length > 1 ? cmdArgs.slice(1).join(" ") : undefined;
      return cmdPublishReel(getPage(assets, pageName), cmdArgs[0], desc);
    }
    case "reels":
      requireArgs(rest, 1, "reels <page>");
      return cmdReels(getPage(assets, pageName));
    case "video-status":
      requireArgs(rest, 2, "video-status <page> <video_id>");
      return cmdVideoStatus(getPage(assets, pageName), cmdArgs[0]);
    case "publish-video": {
      requireArgs(rest, 2, "publish-video <page> <url|file> [title]");
      // Parse --description flag
      const descIdx = cmdArgs.indexOf("--description");
      let desc: string | undefined;
      const filtered = [...cmdArgs];
      if (descIdx !== -1 && descIdx + 1 < cmdArgs.length) {
        desc = cmdArgs[descIdx + 1];
        filtered.splice(descIdx, 2);
      }
      const title = filtered.length > 1 ? filtered.slice(1).join(" ") : undefined;
      return cmdPublishVideo(getPage(assets, pageName), filtered[0], title, desc);
    }

    // Stories
    case "video-story":
      requireArgs(rest, 2, "video-story <page> <url|file>");
      return cmdVideoStory(getPage(assets, pageName), cmdArgs[0]);
    case "photo-story":
      requireArgs(rest, 2, "photo-story <page> <photo_url>");
      return cmdPhotoStory(getPage(assets, pageName), cmdArgs[0]);
    case "stories":
      requireArgs(rest, 1, "stories <page>");
      return cmdStories(getPage(assets, pageName));

    // Slideshows
    case "slideshow": {
      requireArgs(rest, 2, "slideshow <page> <url1,url2,url3,...>");
      let urls: string[];
      if (cmdArgs[0] === "-" || (!cmdArgs[0] && !process.stdin.isTTY)) {
        const stdin = await readStdin();
        if (!stdin) die("No image URLs provided via argument or stdin.");
        urls = stdin.split(/[,\n]+/).map(s => s.trim()).filter(Boolean);
      } else {
        urls = cmdArgs[0].split(",").map(s => s.trim()).filter(Boolean);
      }
      if (urls.length < 3 || urls.length > 7) die("Slideshow requires 3-7 image URLs.");
      const durIdx = cmdArgs.indexOf("--duration");
      const transIdx = cmdArgs.indexOf("--transition");
      const duration = durIdx !== -1 && cmdArgs[durIdx + 1] ? parseInt(cmdArgs[durIdx + 1]) : 1750;
      const transition = transIdx !== -1 && cmdArgs[transIdx + 1] ? parseInt(cmdArgs[transIdx + 1]) : 250;
      return cmdSlideshow(getPage(assets, pageName), urls, duration, transition);
    }

    // Crossposting
    case "crosspost":
      requireArgs(rest, 2, "crosspost <page> <video_id>");
      return cmdCrosspost(getPage(assets, pageName), cmdArgs[0]);
    case "enable-crosspost": {
      requireArgs(rest, 3, "enable-crosspost <page> <video_id> <page_ids,...>");
      const targetIds = cmdArgs[1].split(",").map(s => s.trim()).filter(Boolean);
      return cmdEnableCrosspost(getPage(assets, pageName), cmdArgs[0], targetIds);
    }
    case "crosspost-pages":
      requireArgs(rest, 1, "crosspost-pages <page>");
      return cmdCrosspostPages(getPage(assets, pageName));
    case "crosspost-check":
      requireArgs(rest, 2, "crosspost-check <page> <video_id>");
      return cmdCrosspostCheck(getPage(assets, pageName), cmdArgs[0]);

    // A/B Testing
    case "ab-create": {
      requireArgs(rest, 5, "ab-create <page> <name> <goal> <video_ids,...> <control_id>");
      const name = cmdArgs[0];
      const goal = cmdArgs[1];
      const experimentIds = cmdArgs[2].split(",").map(s => s.trim()).filter(Boolean);
      const controlId = cmdArgs[3];
      const descIdx = cmdArgs.indexOf("--desc");
      const desc = descIdx !== -1 && cmdArgs[descIdx + 1] ? cmdArgs[descIdx + 1] : undefined;
      const durIdx = cmdArgs.indexOf("--duration");
      const duration = durIdx !== -1 && cmdArgs[durIdx + 1] ? parseInt(cmdArgs[durIdx + 1]) : undefined;
      return cmdAbCreate(getPage(assets, pageName), name, goal, experimentIds, controlId, desc, duration);
    }
    case "ab-results":
      requireArgs(rest, 2, "ab-results <page> <test_id>");
      return cmdAbResults(getPage(assets, pageName), cmdArgs[0]);
    case "ab-tests": {
      requireArgs(rest, 1, "ab-tests <page>");
      const sinceIdx = cmdArgs.indexOf("--since");
      const untilIdx = cmdArgs.indexOf("--until");
      const since = sinceIdx !== -1 && cmdArgs[sinceIdx + 1] ? cmdArgs[sinceIdx + 1] : undefined;
      const until = untilIdx !== -1 && cmdArgs[untilIdx + 1] ? cmdArgs[untilIdx + 1] : undefined;
      return cmdAbTests(getPage(assets, pageName), since, until);
    }
    case "ab-delete":
      requireArgs(rest, 2, "ab-delete <page> <test_id>");
      return cmdAbDelete(getPage(assets, pageName), cmdArgs[0]);

    default:
      die(`Unknown command: ${command}. Run 'fbcli --help' for usage.`);
  }
}

main().catch((err) => {
  die(err.message ?? String(err));
});
