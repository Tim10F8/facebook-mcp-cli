/**
 * Facebook MCP Server — TypeScript implementation.
 * Registers all tools via @modelcontextprotocol/sdk McpServer.
 * Replaces the Python server.py + manager.py.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadAssets, type PageAsset } from "./config.js";
import { graphApi } from "./api.js";

// --- Page registry ---

const assets = loadAssets();
const pages = new Map<string, PageAsset>();
for (const asset of assets) {
  pages.set(asset.page_name, asset);
}

function getPage(name: string): PageAsset {
  const page = pages.get(name);
  if (!page) {
    const available = [...pages.keys()].join(", ") || "(none configured)";
    throw new Error(`Page '${name}' not found. Available pages: ${available}`);
  }
  return page;
}

function json(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

// --- Insight metrics ---

const ALL_INSIGHT_METRICS = [
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

const REACTION_METRICS = [
  "post_reactions_like_total",
  "post_reactions_love_total",
  "post_reactions_wow_total",
  "post_reactions_haha_total",
  "post_reactions_sorry_total",
  "post_reactions_anger_total",
];

const NEGATIVE_KEYWORDS = ["bad", "terrible", "awful", "hate", "dislike", "problem", "issue"];

// --- Helpers ---

async function getInsight(pageName: string, postId: string, metric: string) {
  const p = getPage(pageName);
  return graphApi("GET", `${postId}/insights`, p.page_access_token, {
    metric,
    period: "lifetime",
  });
}

// --- Server ---

const server = new McpServer({ name: "FacebookMCP", version: "2.0.0" });

// ── Pages ───────────────────────────────────────────────────────────────

server.tool(
  "list_pages",
  "List all available Facebook Pages.\nInput: None\nOutput: list of page objects with page_name, display_name, fb_page_id",
  {},
  async () => {
    const result = assets.map((a) => ({
      page_name: a.page_name,
      display_name: a.display_name,
      fb_page_id: a.fb_page_id,
    }));
    return json(result);
  },
);

// ── Posts ────────────────────────────────────────────────────────────────

server.tool(
  "post_to_facebook",
  "Create a new Facebook Page post with a text message.\nInput: page_name (str), message (str)\nOutput: dict with post ID and creation status",
  { page_name: z.string(), message: z.string() },
  async ({ page_name, message }) => {
    const p = getPage(page_name);
    return json(await graphApi("POST", `${p.fb_page_id}/feed`, p.page_access_token, { message }));
  },
);

server.tool(
  "get_page_posts",
  "Fetch the most recent posts on the Page.\nInput: page_name (str)\nOutput: dict with list of post objects and metadata",
  { page_name: z.string() },
  async ({ page_name }) => {
    const p = getPage(page_name);
    return json(
      await graphApi("GET", `${p.fb_page_id}/posts`, p.page_access_token, {
        fields: "id,message,created_time",
      }),
    );
  },
);

server.tool(
  "post_image_to_facebook",
  "Post an image with a caption to the Facebook page.\nInput: page_name (str), image_url (str), caption (str)\nOutput: dict of post result",
  { page_name: z.string(), image_url: z.string(), caption: z.string() },
  async ({ page_name, image_url, caption }) => {
    const p = getPage(page_name);
    return json(
      await graphApi("POST", `${p.fb_page_id}/photos`, p.page_access_token, {
        url: image_url,
        caption,
      }),
    );
  },
);

server.tool(
  "update_post",
  "Updates an existing post's message.\nInput: page_name (str), post_id (str), new_message (str)\nOutput: dict of update result",
  { page_name: z.string(), post_id: z.string(), new_message: z.string() },
  async ({ page_name, post_id, new_message }) => {
    const p = getPage(page_name);
    return json(await graphApi("POST", post_id, p.page_access_token, { message: new_message }));
  },
);

server.tool(
  "delete_post",
  "Delete a specific post from the Facebook Page.\nInput: page_name (str), post_id (str)\nOutput: dict with deletion result",
  { page_name: z.string(), post_id: z.string() },
  async ({ page_name, post_id }) => {
    const p = getPage(page_name);
    return json(await graphApi("DELETE", post_id, p.page_access_token));
  },
);

server.tool(
  "schedule_post",
  "Schedule a new post for future publishing.\nInput: page_name (str), message (str), publish_time (Unix timestamp)\nOutput: dict with scheduled post info",
  { page_name: z.string(), message: z.string(), publish_time: z.number() },
  async ({ page_name, message, publish_time }) => {
    const p = getPage(page_name);
    return json(
      await graphApi("POST", `${p.fb_page_id}/feed`, p.page_access_token, {
        message,
        published: "false",
        scheduled_publish_time: String(publish_time),
      }),
    );
  },
);

// ── Comments ────────────────────────────────────────────────────────────

server.tool(
  "get_post_comments",
  "Retrieve all comments for a given post.\nInput: page_name (str), post_id (str)\nOutput: dict with comment objects",
  { page_name: z.string(), post_id: z.string() },
  async ({ page_name, post_id }) => {
    const p = getPage(page_name);
    return json(
      await graphApi("GET", `${post_id}/comments`, p.page_access_token, {
        fields: "id,message,from,created_time",
      }),
    );
  },
);

server.tool(
  "reply_to_comment",
  "Reply to a specific comment on a Facebook post.\nInput: page_name (str), post_id (str), comment_id (str), message (str)\nOutput: dict with reply creation status",
  { page_name: z.string(), post_id: z.string(), comment_id: z.string(), message: z.string() },
  async ({ page_name, comment_id, message }) => {
    const p = getPage(page_name);
    return json(
      await graphApi("POST", `${comment_id}/comments`, p.page_access_token, { message }),
    );
  },
);

server.tool(
  "delete_comment",
  "Delete a specific comment from the Page.\nInput: page_name (str), comment_id (str)\nOutput: dict with deletion result",
  { page_name: z.string(), comment_id: z.string() },
  async ({ page_name, comment_id }) => {
    const p = getPage(page_name);
    return json(await graphApi("DELETE", comment_id, p.page_access_token));
  },
);

server.tool(
  "hide_comment",
  "Hide a comment from public view.\nInput: page_name (str), comment_id (str)\nOutput: dict with hide result",
  { page_name: z.string(), comment_id: z.string() },
  async ({ page_name, comment_id }) => {
    const p = getPage(page_name);
    return json(await graphApi("POST", comment_id, p.page_access_token, { is_hidden: "true" }));
  },
);

server.tool(
  "unhide_comment",
  "Unhide a previously hidden comment.\nInput: page_name (str), comment_id (str)\nOutput: dict with unhide result",
  { page_name: z.string(), comment_id: z.string() },
  async ({ page_name, comment_id }) => {
    const p = getPage(page_name);
    return json(await graphApi("POST", comment_id, p.page_access_token, { is_hidden: "false" }));
  },
);

server.tool(
  "delete_comment_from_post",
  "Alias to delete a comment on a post.\nInput: page_name (str), post_id (str), comment_id (str)\nOutput: dict with deletion result",
  { page_name: z.string(), post_id: z.string(), comment_id: z.string() },
  async ({ page_name, comment_id }) => {
    const p = getPage(page_name);
    return json(await graphApi("DELETE", comment_id, p.page_access_token));
  },
);

server.tool(
  "filter_negative_comments",
  "Filter comments for basic negative sentiment.\nInput: page_name (str), comments (JSON string of comments response)\nOutput: list of flagged negative comments",
  { page_name: z.string(), comments: z.string().describe("JSON string of the comments API response") },
  async ({ comments }) => {
    const parsed = JSON.parse(comments);
    const data: any[] = parsed.data ?? [];
    const flagged = data.filter((c: any) =>
      NEGATIVE_KEYWORDS.some((kw) => (c.message ?? "").toLowerCase().includes(kw)),
    );
    return json(flagged);
  },
);

server.tool(
  "bulk_delete_comments",
  "Delete multiple comments by ID.\nInput: page_name (str), comment_ids (list[str])\nOutput: list of deletion results",
  { page_name: z.string(), comment_ids: z.array(z.string()) },
  async ({ page_name, comment_ids }) => {
    const p = getPage(page_name);
    const results = [];
    for (const cid of comment_ids) {
      const result = await graphApi("DELETE", cid, p.page_access_token);
      results.push({ comment_id: cid, result });
    }
    return json(results);
  },
);

server.tool(
  "bulk_hide_comments",
  "Hide multiple comments by ID.\nInput: page_name (str), comment_ids (list[str])\nOutput: list of hide results",
  { page_name: z.string(), comment_ids: z.array(z.string()) },
  async ({ page_name, comment_ids }) => {
    const p = getPage(page_name);
    const results = [];
    for (const cid of comment_ids) {
      const result = await graphApi("POST", cid, p.page_access_token, { is_hidden: "true" });
      results.push({ comment_id: cid, result });
    }
    return json(results);
  },
);

// ── Analytics ───────────────────────────────────────────────────────────

server.tool(
  "get_number_of_comments",
  "Count the number of comments on a given post.\nInput: page_name (str), post_id (str)\nOutput: integer count of comments",
  { page_name: z.string(), post_id: z.string() },
  async ({ page_name, post_id }) => {
    const p = getPage(page_name);
    const data = await graphApi("GET", `${post_id}/comments`, p.page_access_token, {
      fields: "id",
    });
    return json({ comment_count: (data.data ?? []).length });
  },
);

server.tool(
  "get_number_of_likes",
  "Return the number of likes on a post.\nInput: page_name (str), post_id (str)\nOutput: integer count of likes",
  { page_name: z.string(), post_id: z.string() },
  async ({ page_name, post_id }) => {
    const p = getPage(page_name);
    const data = await graphApi("GET", post_id, p.page_access_token, {
      fields: "likes.summary(true)",
    });
    return json({ likes: data.likes?.summary?.total_count ?? 0 });
  },
);

server.tool(
  "get_post_insights",
  "Fetch all insights metrics (impressions, reactions, clicks, etc).\nInput: page_name (str), post_id (str)\nOutput: dict with multiple metrics and their values",
  { page_name: z.string(), post_id: z.string() },
  async ({ page_name, post_id }) => {
    const p = getPage(page_name);
    return json(
      await graphApi("GET", `${post_id}/insights`, p.page_access_token, {
        metric: ALL_INSIGHT_METRICS.join(","),
        period: "lifetime",
      }),
    );
  },
);

server.tool(
  "get_post_impressions",
  "Fetch total impressions of a post.\nInput: page_name (str), post_id (str)\nOutput: dict with total impression count",
  { page_name: z.string(), post_id: z.string() },
  async ({ page_name, post_id }) => {
    return json(await getInsight(page_name, post_id, "post_impressions"));
  },
);

server.tool(
  "get_post_impressions_unique",
  "Fetch unique impressions of a post.\nInput: page_name (str), post_id (str)\nOutput: dict with unique impression count",
  { page_name: z.string(), post_id: z.string() },
  async ({ page_name, post_id }) => {
    return json(await getInsight(page_name, post_id, "post_impressions_unique"));
  },
);

server.tool(
  "get_post_impressions_paid",
  "Fetch paid impressions of a post.\nInput: page_name (str), post_id (str)\nOutput: dict with paid impression count",
  { page_name: z.string(), post_id: z.string() },
  async ({ page_name, post_id }) => {
    return json(await getInsight(page_name, post_id, "post_impressions_paid"));
  },
);

server.tool(
  "get_post_impressions_organic",
  "Fetch organic impressions of a post.\nInput: page_name (str), post_id (str)\nOutput: dict with organic impression count",
  { page_name: z.string(), post_id: z.string() },
  async ({ page_name, post_id }) => {
    return json(await getInsight(page_name, post_id, "post_impressions_organic"));
  },
);

server.tool(
  "get_post_engaged_users",
  "Fetch number of engaged users.\nInput: page_name (str), post_id (str)\nOutput: dict with engagement count",
  { page_name: z.string(), post_id: z.string() },
  async ({ page_name, post_id }) => {
    return json(await getInsight(page_name, post_id, "post_engaged_users"));
  },
);

server.tool(
  "get_post_clicks",
  "Fetch number of post clicks.\nInput: page_name (str), post_id (str)\nOutput: dict with click count",
  { page_name: z.string(), post_id: z.string() },
  async ({ page_name, post_id }) => {
    return json(await getInsight(page_name, post_id, "post_clicks"));
  },
);

server.tool(
  "get_post_reactions_like_total",
  "Fetch number of 'Like' reactions.\nInput: page_name (str), post_id (str)\nOutput: dict with like count",
  { page_name: z.string(), post_id: z.string() },
  async ({ page_name, post_id }) => {
    return json(await getInsight(page_name, post_id, "post_reactions_like_total"));
  },
);

server.tool(
  "get_post_reactions_love_total",
  "Fetch number of 'Love' reactions.\nInput: page_name (str), post_id (str)\nOutput: dict with love count",
  { page_name: z.string(), post_id: z.string() },
  async ({ page_name, post_id }) => {
    return json(await getInsight(page_name, post_id, "post_reactions_love_total"));
  },
);

server.tool(
  "get_post_reactions_wow_total",
  "Fetch number of 'Wow' reactions.\nInput: page_name (str), post_id (str)\nOutput: dict with wow count",
  { page_name: z.string(), post_id: z.string() },
  async ({ page_name, post_id }) => {
    return json(await getInsight(page_name, post_id, "post_reactions_wow_total"));
  },
);

server.tool(
  "get_post_reactions_haha_total",
  "Fetch number of 'Haha' reactions.\nInput: page_name (str), post_id (str)\nOutput: dict with haha count",
  { page_name: z.string(), post_id: z.string() },
  async ({ page_name, post_id }) => {
    return json(await getInsight(page_name, post_id, "post_reactions_haha_total"));
  },
);

server.tool(
  "get_post_reactions_sorry_total",
  "Fetch number of 'Sorry' reactions.\nInput: page_name (str), post_id (str)\nOutput: dict with sorry count",
  { page_name: z.string(), post_id: z.string() },
  async ({ page_name, post_id }) => {
    return json(await getInsight(page_name, post_id, "post_reactions_sorry_total"));
  },
);

server.tool(
  "get_post_reactions_anger_total",
  "Fetch number of 'Anger' reactions.\nInput: page_name (str), post_id (str)\nOutput: dict with anger count",
  { page_name: z.string(), post_id: z.string() },
  async ({ page_name, post_id }) => {
    return json(await getInsight(page_name, post_id, "post_reactions_anger_total"));
  },
);

server.tool(
  "get_post_top_commenters",
  "Get the top commenters on a post.\nInput: page_name (str), post_id (str)\nOutput: list of user IDs with comment counts",
  { page_name: z.string(), post_id: z.string() },
  async ({ page_name, post_id }) => {
    const p = getPage(page_name);
    const data = await graphApi("GET", `${post_id}/comments`, p.page_access_token, {
      fields: "id,message,from,created_time",
    });
    const counter: Record<string, number> = {};
    for (const comment of data.data ?? []) {
      const userId = comment.from?.id;
      if (userId) counter[userId] = (counter[userId] ?? 0) + 1;
    }
    const sorted = Object.entries(counter)
      .map(([user_id, count]) => ({ user_id, count }))
      .sort((a, b) => b.count - a.count);
    return json(sorted);
  },
);

server.tool(
  "get_page_fan_count",
  "Get the Page's total fan/like count.\nInput: page_name (str)\nOutput: integer fan count",
  { page_name: z.string() },
  async ({ page_name }) => {
    const p = getPage(page_name);
    const data = await graphApi("GET", p.fb_page_id, p.page_access_token, {
      fields: "fan_count",
    });
    return json({ fan_count: data.fan_count ?? 0 });
  },
);

server.tool(
  "get_post_share_count",
  "Get the number of shares for a post.\nInput: page_name (str), post_id (str)\nOutput: integer share count",
  { page_name: z.string(), post_id: z.string() },
  async ({ page_name, post_id }) => {
    const p = getPage(page_name);
    const data = await graphApi("GET", post_id, p.page_access_token, { fields: "shares" });
    return json({ shares: data.shares?.count ?? 0 });
  },
);

server.tool(
  "get_post_reactions_breakdown",
  "Get counts for all reaction types on a post.\nInput: page_name (str), post_id (str)\nOutput: dict with reaction type counts",
  { page_name: z.string(), post_id: z.string() },
  async ({ page_name, post_id }) => {
    const p = getPage(page_name);
    const raw = await graphApi("GET", `${post_id}/insights`, p.page_access_token, {
      metric: REACTION_METRICS.join(","),
      period: "lifetime",
    });
    const results: Record<string, unknown> = {};
    for (const item of raw.data ?? []) {
      results[item.name] = item.values?.[0]?.value;
    }
    return json(results);
  },
);

// ── Messaging ───────────────────────────────────────────────────────────

server.tool(
  "send_dm_to_user",
  "Send a direct message to a user.\nInput: page_name (str), user_id (str), message (str)\nOutput: dict of result from Messenger API",
  { page_name: z.string(), user_id: z.string(), message: z.string() },
  async ({ page_name, user_id, message }) => {
    const p = getPage(page_name);
    return json(
      await graphApi("POST", "me/messages", p.page_access_token, undefined, {
        recipient: { id: user_id },
        message: { text: message },
        messaging_type: "RESPONSE",
      }),
    );
  },
);

// --- Start ---

const transport = new StdioServerTransport();
await server.connect(transport);
