/**
 * Facebook MCP Server — TypeScript implementation.
 * Registers all tools via @modelcontextprotocol/sdk McpServer.
 * Replaces the Python server.py + manager.py.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadAssets, loadAppConfig, type PageAsset } from "./config.js";
import { graphApi, graphApiBatch, ruploadApi } from "./api.js";

// --- Page registry ---

const assets = loadAssets();
const pages = new Map<string, PageAsset>();
for (const asset of assets) {
  pages.set(asset.page_name, asset);
}

const appConfig = loadAppConfig();

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

const server = new McpServer({ name: "FacebookMCP", version: "3.0.0" });

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
  "Delete multiple comments by ID using batch API.\nInput: page_name (str), comment_ids (list[str])\nOutput: list of deletion results",
  { page_name: z.string(), comment_ids: z.array(z.string()) },
  async ({ page_name, comment_ids }) => {
    const p = getPage(page_name);
    const requests = comment_ids.map((cid) => ({
      method: "DELETE",
      relative_url: cid,
    }));
    const responses = await graphApiBatch(p.page_access_token, requests);
    return json(
      comment_ids.map((cid, i) => ({
        comment_id: cid,
        result: responses[i].body,
        success: responses[i].code === 200,
      })),
    );
  },
);

server.tool(
  "bulk_hide_comments",
  "Hide multiple comments by ID using batch API.\nInput: page_name (str), comment_ids (list[str])\nOutput: list of hide results",
  { page_name: z.string(), comment_ids: z.array(z.string()) },
  async ({ page_name, comment_ids }) => {
    const p = getPage(page_name);
    const requests = comment_ids.map((cid) => ({
      method: "POST",
      relative_url: cid,
      body: { is_hidden: "true" },
    }));
    const responses = await graphApiBatch(p.page_access_token, requests);
    return json(
      comment_ids.map((cid, i) => ({
        comment_id: cid,
        result: responses[i].body,
        success: responses[i].code === 200,
      })),
    );
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

// ── Reels ────────────────────────────────────────────────────────────────

server.tool(
  "publish_reel",
  "Publish a video reel to a Facebook Page.\nInput: page_name (str), video_url (str), description (str, optional), title (str, optional)\nOutput: dict with reel publish result",
  {
    page_name: z.string(),
    video_url: z.string(),
    description: z.string().optional(),
    title: z.string().optional(),
  },
  async ({ page_name, video_url, description, title }) => {
    const p = getPage(page_name);
    const start = await graphApi("POST", `${p.fb_page_id}/video_reels`, p.page_access_token, {
      upload_phase: "start",
    });
    const videoId = start.video_id;
    await ruploadApi(videoId, p.page_access_token, { file_url: video_url });
    const finishParams: Record<string, string> = {
      upload_phase: "finish",
      video_id: videoId,
      video_state: "PUBLISHED",
    };
    if (description) finishParams.description = description;
    if (title) finishParams.title = title;
    return json(
      await graphApi("POST", `${p.fb_page_id}/video_reels`, p.page_access_token, finishParams),
    );
  },
);

server.tool(
  "list_reels",
  "List reels published on a Facebook Page.\nInput: page_name (str)\nOutput: dict with list of reel objects",
  { page_name: z.string() },
  async ({ page_name }) => {
    const p = getPage(page_name);
    return json(await graphApi("GET", `${p.fb_page_id}/video_reels`, p.page_access_token));
  },
);

server.tool(
  "get_video_status",
  "Get the processing status of a video.\nInput: page_name (str), video_id (str)\nOutput: dict with video status info",
  { page_name: z.string(), video_id: z.string() },
  async ({ page_name, video_id }) => {
    const p = getPage(page_name);
    return json(
      await graphApi("GET", video_id, p.page_access_token, { fields: "status" }),
    );
  },
);

// ── Stories ───────────────────────────────────────────────────────────────

server.tool(
  "publish_video_story",
  "Publish a video story to a Facebook Page.\nInput: page_name (str), video_url (str)\nOutput: dict with story publish result",
  { page_name: z.string(), video_url: z.string() },
  async ({ page_name, video_url }) => {
    const p = getPage(page_name);
    const start = await graphApi("POST", `${p.fb_page_id}/video_stories`, p.page_access_token, {
      upload_phase: "start",
    });
    const videoId = start.video_id;
    await ruploadApi(videoId, p.page_access_token, { file_url: video_url });
    return json(
      await graphApi("POST", `${p.fb_page_id}/video_stories`, p.page_access_token, {
        upload_phase: "finish",
        video_id: videoId,
      }),
    );
  },
);

server.tool(
  "publish_photo_story",
  "Publish a photo story to a Facebook Page.\nInput: page_name (str), photo_url (str)\nOutput: dict with story publish result",
  { page_name: z.string(), photo_url: z.string() },
  async ({ page_name, photo_url }) => {
    const p = getPage(page_name);
    const uploaded = await graphApi("POST", `${p.fb_page_id}/photos`, p.page_access_token, {
      url: photo_url,
      published: "false",
    });
    const photoId = uploaded.id;
    return json(
      await graphApi("POST", `${p.fb_page_id}/photo_stories`, p.page_access_token, {
        photo_id: photoId,
      }),
    );
  },
);

server.tool(
  "list_stories",
  "List stories on a Facebook Page.\nInput: page_name (str)\nOutput: dict with list of story objects",
  { page_name: z.string() },
  async ({ page_name }) => {
    const p = getPage(page_name);
    return json(await graphApi("GET", `${p.fb_page_id}/stories`, p.page_access_token));
  },
);

// ── Slideshows ───────────────────────────────────────────────────────────

server.tool(
  "create_slideshow",
  "Create a slideshow video from images.\nInput: page_name (str), image_urls (list[str], 3-7), duration_ms (number, optional), transition_ms (number, optional)\nOutput: dict with slideshow creation result",
  {
    page_name: z.string(),
    image_urls: z.array(z.string()).min(3).max(7),
    duration_ms: z.number().optional(),
    transition_ms: z.number().optional(),
  },
  async ({ page_name, image_urls, duration_ms, transition_ms }) => {
    const p = getPage(page_name);
    return json(
      await graphApi("POST", `${p.fb_page_id}/videos`, p.page_access_token, undefined, {
        slideshow_spec: JSON.stringify({
          images_urls: image_urls,
          duration_ms: duration_ms ?? 1750,
          transition_ms: transition_ms ?? 250,
        }),
      }),
    );
  },
);

// ── Video Publishing ─────────────────────────────────────────────────────

server.tool(
  "publish_video",
  "Publish a video to a Facebook Page from a URL.\nInput: page_name (str), video_url (str), title (str, optional), description (str, optional)\nOutput: dict with video publish result",
  {
    page_name: z.string(),
    video_url: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
  },
  async ({ page_name, video_url, title, description }) => {
    const p = getPage(page_name);
    const params: Record<string, string> = { file_url: video_url };
    if (title) params.title = title;
    if (description) params.description = description;
    return json(
      await graphApi("POST", `${p.fb_page_id}/videos`, p.page_access_token, params),
    );
  },
);

// ── Music ────────────────────────────────────────────────────────────────

server.tool(
  "get_music_recommendations",
  "Get music recommendations from Facebook.\nInput: type (enum), countries (str, optional)\nOutput: dict with music recommendation results",
  {
    type: z.enum(["FACEBOOK_POPULAR_MUSIC", "FACEBOOK_NEW_MUSIC", "FACEBOOK_FOR_YOU"]),
    countries: z.string().optional(),
  },
  async ({ type, countries }) => {
    const token = assets[0].page_access_token;
    const params: Record<string, string> = { type };
    if (countries) params.countries = countries;
    return json(await graphApi("GET", "audio/recommendations", token, params));
  },
);

// ── Crossposting ─────────────────────────────────────────────────────────

server.tool(
  "crosspost_video",
  "Crosspost an existing video to a Facebook Page.\nInput: page_name (str), video_id (str)\nOutput: dict with crosspost result",
  { page_name: z.string(), video_id: z.string() },
  async ({ page_name, video_id }) => {
    const p = getPage(page_name);
    return json(
      await graphApi("POST", `${p.fb_page_id}/videos`, p.page_access_token, {
        crossposted_video_id: video_id,
      }),
    );
  },
);

server.tool(
  "enable_crossposting",
  "Enable crossposting for a video to specified target pages.\nInput: page_name (str), video_id (str), target_page_ids (list[str])\nOutput: dict with crossposting enablement result",
  { page_name: z.string(), video_id: z.string(), target_page_ids: z.array(z.string()) },
  async ({ page_name, video_id, target_page_ids }) => {
    const p = getPage(page_name);
    return json(
      await graphApi("POST", video_id, p.page_access_token, undefined, {
        allow_crossposting_for_pages: target_page_ids,
      }),
    );
  },
);

server.tool(
  "crosspost_eligible_pages",
  "List pages eligible for crossposting.\nInput: page_name (str)\nOutput: dict with list of eligible page objects",
  { page_name: z.string() },
  async ({ page_name }) => {
    const p = getPage(page_name);
    return json(
      await graphApi("GET", `${p.fb_page_id}/crosspost_whitelisted_pages`, p.page_access_token),
    );
  },
);

server.tool(
  "check_crosspost_eligibility",
  "Check if a video is eligible for crossposting.\nInput: page_name (str), video_id (str)\nOutput: dict with crossposting eligibility status",
  { page_name: z.string(), video_id: z.string() },
  async ({ page_name, video_id }) => {
    const p = getPage(page_name);
    return json(
      await graphApi("GET", video_id, p.page_access_token, {
        fields: "is_crossposting_eligible",
      }),
    );
  },
);

// ── A/B Testing ──────────────────────────────────────────────────────────

server.tool(
  "create_ab_test",
  "Create an A/B test for video content.\nInput: page_name (str), name (str), description (str), experiment_video_ids (list[str], 2-4), control_video_id (str), optimization_goal (enum), duration_seconds (number, optional), scheduled_timestamp (number, optional)\nOutput: dict with A/B test creation result",
  {
    page_name: z.string(),
    name: z.string(),
    description: z.string(),
    experiment_video_ids: z.array(z.string()).min(2).max(4),
    control_video_id: z.string(),
    optimization_goal: z.enum([
      "AVG_TIME_WATCHED",
      "COMMENTS",
      "IMPRESSIONS",
      "IMPRESSIONS_UNIQUE",
      "LINK_CLICKS",
      "REACTIONS",
      "REELS_PLAYS",
      "SHARES",
      "VIDEO_VIEWS_60S",
    ]),
    duration_seconds: z.number().optional(),
    scheduled_timestamp: z.number().optional(),
  },
  async ({
    page_name,
    name,
    description,
    experiment_video_ids,
    control_video_id,
    optimization_goal,
    duration_seconds,
    scheduled_timestamp,
  }) => {
    const p = getPage(page_name);
    const body: Record<string, unknown> = {
      name,
      description,
      experiment_video_ids,
      control_video_id,
      optimization_goal,
    };
    if (duration_seconds !== undefined) body.duration_seconds = duration_seconds;
    if (scheduled_timestamp !== undefined) body.scheduled_experiment_timestamp = scheduled_timestamp;
    return json(
      await graphApi("POST", `${p.fb_page_id}/ab_tests`, p.page_access_token, undefined, body),
    );
  },
);

server.tool(
  "get_ab_test",
  "Get details of an A/B test.\nInput: page_name (str), test_id (str)\nOutput: dict with A/B test details",
  { page_name: z.string(), test_id: z.string() },
  async ({ page_name, test_id }) => {
    const p = getPage(page_name);
    return json(await graphApi("GET", test_id, p.page_access_token));
  },
);

server.tool(
  "list_ab_tests",
  "List A/B tests for a Facebook Page.\nInput: page_name (str), since (str, optional), until (str, optional)\nOutput: dict with list of A/B test objects",
  {
    page_name: z.string(),
    since: z.string().optional(),
    until: z.string().optional(),
  },
  async ({ page_name, since, until }) => {
    const p = getPage(page_name);
    const params: Record<string, string> = {};
    if (since) params.since = since;
    if (until) params.until = until;
    return json(
      await graphApi("GET", `${p.fb_page_id}/ab_tests`, p.page_access_token, params),
    );
  },
);

server.tool(
  "delete_ab_test",
  "Delete an A/B test.\nInput: page_name (str), test_id (str)\nOutput: dict with deletion result",
  { page_name: z.string(), test_id: z.string() },
  async ({ page_name, test_id }) => {
    const p = getPage(page_name);
    return json(await graphApi("DELETE", test_id, p.page_access_token));
  },
);

// --- Start ---

const transport = new StdioServerTransport();
await server.connect(transport);
