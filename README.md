# Facebook MCP Server & CLI Tools

> **Inspired by [HagaiHen/facebook-mcp-server](https://github.com/HagaiHen/facebook-mcp-server)** — rewritten in TypeScript with **multi-page management** via a `FACEBOOK_ASSETS` JSON configuration. Source: [2b3pro/facebook-mcp-cli](https://github.com/2b3pro/facebook-mcp-cli)

A **TypeScript MCP server** for automating and managing interactions on Facebook Pages using the Facebook Graph API. Exposes 36 tools for posting, comment moderation, analytics, and engagement tracking — ready to plug into Claude Desktop or other LLM-based agents. Includes a standalone CLI for direct shell access.

---

## What Is This?

This MCP provides a suite of AI-callable tools that connect directly to Facebook Pages, abstracting common API operations as LLM-friendly functions.

### Benefits

- Empowers **social media managers** to automate moderation and analytics.
- Seamlessly integrates with **Claude Desktop or any MCP-compatible agent**.
- Enables fine-grained control over Facebook content from natural language.
- **Standalone CLI** (`cli/fbcli.ts`) for direct shell scripting and automation.

---

## Features

All tools (except `list_pages`) take `page_name` as the first parameter — a slug-style identifier for the target page (e.g. `"mybusiness"`).

| Tool                             | Description                                                         |
|----------------------------------|---------------------------------------------------------------------|
| `list_pages`                     | List all configured Facebook Pages (no `page_name` param needed).   |
| `post_to_facebook`               | Create a new Facebook post with a message.                          |
| `reply_to_comment`               | Reply to a specific comment on a post.                              |
| `get_page_posts`                 | Retrieve recent posts from the Page.                                |
| `get_post_comments`              | Fetch comments on a given post.                                     |
| `delete_post`                    | Delete a specific post by ID.                                       |
| `delete_comment`                 | Delete a specific comment by ID.                                    |
| `hide_comment`                   | Hide a comment from public view.                                    |
| `unhide_comment`                 | Unhide a previously hidden comment.                                 |
| `delete_comment_from_post`       | Alias for deleting a comment from a specific post.                  |
| `filter_negative_comments`       | Filter out comments with negative sentiment keywords.               |
| `get_number_of_comments`         | Count the number of comments on a post.                             |
| `get_number_of_likes`            | Count the number of likes on a post.                                |
| `get_post_insights`              | Get all insights metrics for a post.                                |
| `get_post_impressions`           | Get total impressions on a post.                                    |
| `get_post_impressions_unique`    | Get number of unique users who saw the post.                        |
| `get_post_impressions_paid`      | Get number of paid impressions on the post.                         |
| `get_post_impressions_organic`   | Get number of organic impressions on the post.                      |
| `get_post_engaged_users`         | Get number of users who engaged with the post.                      |
| `get_post_clicks`                | Get number of clicks on the post.                                   |
| `get_post_reactions_like_total`  | Get total number of 'Like' reactions.                               |
| `get_post_reactions_love_total`  | Get total number of 'Love' reactions.                               |
| `get_post_reactions_wow_total`   | Get total number of 'Wow' reactions.                                |
| `get_post_reactions_haha_total`  | Get total number of 'Haha' reactions.                               |
| `get_post_reactions_sorry_total` | Get total number of 'Sorry' reactions.                              |
| `get_post_reactions_anger_total` | Get total number of 'Anger' reactions.                              |
| `get_post_top_commenters`        | Get the top commenters on a post.                                   |
| `post_image_to_facebook`         | Post an image with a caption to the Facebook page.                  |
| `send_dm_to_user`                | Send a direct message to a user.                                    |
| `update_post`                    | Updates an existing post's message.                                 |
| `schedule_post`                  | Schedule a post for future publication.                             |
| `get_page_fan_count`             | Retrieve the total number of Page fans.                             |
| `get_post_share_count`           | Get the number of shares on a post.                                 |
| `get_post_reactions_breakdown`   | Get all reaction counts for a post in one call.                     |
| `bulk_delete_comments`           | Delete multiple comments by ID.                                     |
| `bulk_hide_comments`             | Hide multiple comments by ID.                                       |

---

## Setup & Installation

### 1. Clone the Repository

```bash
git clone https://github.com/2b3pro/facebook-mcp-cli.git
cd facebook-mcp-cli
```

### 2. Install Dependencies

Requires [Bun](https://bun.sh) runtime:

```bash
bun install
```

### 3. Set Up Environment

Create a `.env` file in the project root with a `FACEBOOK_ASSETS` JSON array:

```
FACEBOOK_ASSETS='[{"fb_page_id":"123456","page_name":"mybusiness","display_name":"My Business Page","page_access_token":"EAA..."},{"fb_page_id":"789012","page_name":"sideproject","display_name":"Side Project","page_access_token":"EAA..."}]'
```

Each entry requires:

| Field | Description |
|-------|-------------|
| `fb_page_id` | Facebook Page ID |
| `page_name` | Slug identifier (lowercase, no spaces) — used as first param in all tools |
| `display_name` | Human-readable label |
| `page_access_token` | Page access token from [Graph API Explorer](https://developers.facebook.com/tools/explorer) |

### 4. Run the MCP Server

```bash
bun run src/server.ts
```

---

## Using with Claude Desktop

Add the following to your Claude Desktop config (`~/.claude.json` under `mcpServers`):

```json
"facebook-mcp": {
  "command": "bun",
  "args": ["run", "/path/to/facebook-mcp-cli/src/server.ts"],
  "env": {
    "FACEBOOK_ASSETS": "[{\"fb_page_id\":\"123\",\"page_name\":\"mypage\",\"display_name\":\"My Page\",\"page_access_token\":\"EAA...\"}]"
  }
}
```

---

## CLI

A standalone CLI is available at `cli/fbcli.ts` for direct shell access to all the same operations. See [cli/README.md](cli/README.md) for full documentation.

```bash
bun run cli/fbcli.ts --help
bun run cli/fbcli.ts pages
bun run cli/fbcli.ts posts mybusiness
```

---

## Architecture

### MCP Server (`src/`)

```
src/server.ts  →  src/api.ts  →  Facebook Graph API
(MCP tools)       (HTTP wrapper)
     ↑
src/config.ts
(env + types)
```

- **src/config.ts** — `PageAsset` interface, env loading, API base URL
- **src/api.ts** — `graphApi()` single-function HTTP wrapper using native `fetch`
- **src/server.ts** — All 36 MCP tools via `@modelcontextprotocol/sdk`

### CLI (`cli/`)

Self-contained single-file CLI at `cli/fbcli.ts`. Independent of the MCP server — reads its own `.env`.

---

## Contributing

Contributions, issues, and feature requests are welcome!

- Create a branch: `git checkout -b feature/YourFeature`
- Commit your changes: `git commit -m 'feat: add new feature'`
- Push to the branch: `git push origin feature/YourFeature`
- Open a pull request
