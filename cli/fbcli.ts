#!/usr/bin/env bun
/**
 * fbcli — Facebook Page Management CLI
 * Standalone shell interface to the Facebook Graph API.
 * Reads FACEBOOK_ASSETS from .env in the fbcli directory.
 */

import { readFileSync, existsSync } from "fs";
import { dirname, join } from "path";

const VERSION = "1.0.0";
const GRAPH_API_BASE = "https://graph.facebook.com/v22.0";
const SCRIPT_DIR = dirname(Bun.main);
const ENV_PATH = join(SCRIPT_DIR, ".env");

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
  const res = await fetch(url.toString(), opts);
  return res.json();
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
  const commentIds = ids.split(",");
  const results = [];
  for (const cid of commentIds) {
    const result = await graphApi("DELETE", cid.trim(), page.page_access_token);
    results.push({ comment_id: cid.trim(), result });
  }
  out(results);
}

async function cmdBulkHide(page: PageAsset, ids: string) {
  const commentIds = ids.split(",");
  const results = [];
  for (const cid of commentIds) {
    const result = await graphApi("POST", cid.trim(), page.page_access_token, {
      is_hidden: "true",
    });
    results.push({ comment_id: cid.trim(), result });
  }
  out(results);
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
    post <page> <message>                Create text post
    post-image <page> <url> <caption>    Post image with caption
    update-post <page> <post_id> <msg>   Update post message
    delete-post <page> <post_id>         Delete post
    schedule <page> <msg> <timestamp>    Schedule future post (Unix ts)

  Comments
    comments <page> <post_id>            List comments on post
    reply <page> <comment_id> <msg>      Reply to comment
    delete-comment <page> <comment_id>   Delete comment
    hide-comment <page> <comment_id>     Hide comment
    unhide-comment <page> <comment_id>   Unhide comment
    bulk-delete <page> <id1,id2,...>      Bulk delete comments
    bulk-hide <page> <id1,id2,...>        Bulk hide comments

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
    dm <page> <user_id> <message>        Send DM

EXAMPLES
  # List configured pages
  fbcli pages

  # Create a text post
  fbcli post mybusiness "Check out our new product launch!"

  # Post an image with caption
  fbcli post-image mybusiness https://example.com/photo.jpg "Our team at the event"

  # Schedule a post for Feb 15 2026 at noon UTC
  fbcli schedule mybusiness "Coming soon!" 1771069200

  # View comments on a post, then reply to one
  fbcli comments mybusiness 123456789_987654321
  fbcli reply mybusiness 123456789_111 "Thanks for the feedback!"

  # Hide multiple spam comments at once (comma-separated, no spaces)
  fbcli bulk-hide mybusiness 123_111,123_222,123_333

  # Get full analytics for a post
  fbcli insights mybusiness 123456789_987654321

  # Get reaction breakdown
  fbcli reactions mybusiness 123456789_987654321

  # Send a DM to a user
  fbcli dm mybusiness 1234567890 "Thanks for reaching out!"

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
    case "post":
      requireArgs(rest, 2, "post <page> <message>");
      return cmdPost(getPage(assets, pageName), cmdArgs.join(" "));
    case "post-image":
      requireArgs(rest, 3, "post-image <page> <url> <caption>");
      return cmdPostImage(getPage(assets, pageName), cmdArgs[0], cmdArgs.slice(1).join(" "));
    case "update-post":
      requireArgs(rest, 3, "update-post <page> <post_id> <message>");
      return cmdUpdatePost(getPage(assets, pageName), cmdArgs[0], cmdArgs.slice(1).join(" "));
    case "delete-post":
      requireArgs(rest, 2, "delete-post <page> <post_id>");
      return cmdDeletePost(getPage(assets, pageName), cmdArgs[0]);
    case "schedule":
      requireArgs(rest, 3, "schedule <page> <message> <timestamp>");
      // Last arg is timestamp, everything between page and timestamp is message
      return cmdSchedule(
        getPage(assets, pageName),
        cmdArgs.slice(0, -1).join(" "),
        cmdArgs[cmdArgs.length - 1]
      );

    // Comments
    case "comments":
      requireArgs(rest, 2, "comments <page> <post_id>");
      return cmdComments(getPage(assets, pageName), cmdArgs[0]);
    case "reply":
      requireArgs(rest, 3, "reply <page> <comment_id> <message>");
      return cmdReply(getPage(assets, pageName), cmdArgs[0], cmdArgs.slice(1).join(" "));
    case "delete-comment":
      requireArgs(rest, 2, "delete-comment <page> <comment_id>");
      return cmdDeleteComment(getPage(assets, pageName), cmdArgs[0]);
    case "hide-comment":
      requireArgs(rest, 2, "hide-comment <page> <comment_id>");
      return cmdHideComment(getPage(assets, pageName), cmdArgs[0]);
    case "unhide-comment":
      requireArgs(rest, 2, "unhide-comment <page> <comment_id>");
      return cmdUnhideComment(getPage(assets, pageName), cmdArgs[0]);
    case "bulk-delete":
      requireArgs(rest, 2, "bulk-delete <page> <id1,id2,...>");
      return cmdBulkDelete(getPage(assets, pageName), cmdArgs[0]);
    case "bulk-hide":
      requireArgs(rest, 2, "bulk-hide <page> <id1,id2,...>");
      return cmdBulkHide(getPage(assets, pageName), cmdArgs[0]);

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
    case "dm":
      requireArgs(rest, 3, "dm <page> <user_id> <message>");
      return cmdDm(getPage(assets, pageName), cmdArgs[0], cmdArgs.slice(1).join(" "));

    default:
      die(`Unknown command: ${command}. Run 'fbcli --help' for usage.`);
  }
}

main().catch((err) => {
  die(err.message ?? String(err));
});
