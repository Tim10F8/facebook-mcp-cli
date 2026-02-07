# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A TypeScript MCP (Model Context Protocol) server for automating Facebook Page management via the Facebook Graph API. Exposes 50+ tools for posting, comment moderation, analytics, engagement tracking, video/reels/stories publishing, crossposting, and A/B testing to Claude Desktop and other LLM agents. Includes a standalone CLI for direct shell access.

## Running the Server

```bash
# Install dependencies
bun install

# Run MCP server (stdio transport)
bun run src/server.ts
```

## Running the CLI

```bash
bun run cli/fbcli.ts --help
bun run cli/fbcli.ts pages
bun run cli/fbcli.ts posts <page_name>
```

There are no tests, linting, or build steps configured in this project.

## Environment Setup

Requires a `.env` file in the project root with a `FACEBOOK_ASSETS` JSON array:
```
FACEBOOK_ASSETS='[{"fb_page_id":"123456","page_name":"mybusiness","display_name":"My Business Page","page_access_token":"EAA..."},{"fb_page_id":"789012","page_name":"sideproject","display_name":"Side Project","page_access_token":"EAA..."}]'
```

Each entry requires:
- `fb_page_id` — Facebook Page ID
- `page_name` — slug-style identifier (lowercase, no spaces) used by all tools
- `display_name` — human-readable label shown in `list_pages()` output
- `page_access_token` — Page access token

Optional env vars for local file uploads (video publishing):
```
FB_APP_ID=123456789
FB_USER_ACCESS_TOKEN=EAA...
```

- `FB_APP_ID` — needed for Resumable Upload API (local file uploads)
- `FB_USER_ACCESS_TOKEN` — needed for Resumable Upload API init/transfer steps
- Both are optional — URL-based uploads work with existing page tokens only

Credentials come from https://developers.facebook.com/tools/explorer. The Graph API version is hardcoded to `v22.0` in `src/config.ts`.

## Architecture

### MCP Server (`src/`)

Three-file architecture:

```
src/server.ts  →  src/api.ts  →  Facebook Graph API
(MCP tools)       (HTTP wrapper)
     ↑
src/config.ts
(env + types)
```

**src/config.ts** — `PageAsset` interface, `AppConfig` interface, `GRAPH_API_BASE` constant, `loadAssets()` for page config, `loadAppConfig()` for optional `FB_APP_ID`/`FB_USER_ACCESS_TOKEN`. Bun auto-loads `.env` from CWD.

**src/api.ts** — Three API wrappers:
- `graphApi(method, endpoint, token, params?, body?)` — standard Graph API calls via `graph.facebook.com`
- `ruploadApi(endpoint, token, headers?, body?)` — upload to `rupload.facebook.com` for Reels/Stories (uses `Authorization: OAuth` header)
- `resumableUpload(appId, userToken, fileData, fileName, fileSize, fileType)` — 2-step Resumable Upload API for local file uploads (init session → transfer binary → returns file handle)
- `graphApiBatch(token, requests[])` — batch API calls (auto-chunks at 50)

**src/server.ts** — Registers 53 MCP tools via `McpServer.tool()` from `@modelcontextprotocol/sdk`. Organized by section:
- **Pages** — list_pages
- **Posts** — CRUD, scheduling, image posting
- **Comments** — CRUD, hide/unhide, bulk operations, sentiment filtering
- **Analytics** — insights, impressions, reactions, engagement metrics
- **Messaging** — send_dm_to_user
- **Reels** — publish_reel (3-step upload), list_reels, get_video_status
- **Stories** — publish_video_story (3-step), publish_photo_story (2-step), list_stories
- **Slideshows** — create_slideshow (3-7 images)
- **Video** — publish_video (URL or file handle)
- **Music** — get_music_recommendations
- **Crossposting** — crosspost_video, enable_crossposting, crosspost_eligible_pages, check_crosspost_eligibility
- **A/B Testing** — create_ab_test, get_ab_test, list_ab_tests, delete_ab_test

### CLI (`cli/`)

Self-contained standalone CLI at `cli/fbcli.ts`. Reads its own `.env` file from the cli/ directory. Uses the same Graph API patterns but is independent of the MCP server code.

Commands that accept text content (messages, captions) or ID lists support **stdin fallback** — when the arg is omitted or `-`, the CLI reads from stdin. This enables Unix piping: `cat draft.txt | fbcli post mypage`. Three helpers handle this: `readStdin()` (TTY-aware), `resolveText()` (for messages), `resolveIds()` (for bulk ID lists with newline normalization).

## Adding a New Tool

1. If needed, add a helper function or adjust `graphApi()` call in `src/api.ts`
2. Register the tool in `src/server.ts` with `server.tool()`, providing:
   - Tool name (snake_case)
   - Description (with Input/Output format for LLM consumption)
   - Zod schema for parameters
   - Async handler that calls `graphApi()` and returns via `json()` helper

## Key Dependencies

- `@modelcontextprotocol/sdk` — MCP server framework (TypeScript)
- `zod` — Schema validation for tool parameters
- `bun` — Runtime (TypeScript execution, .env loading, native fetch)

## Conventions

- All tool functions take `page_name: string` as the first parameter (except `list_pages` and `get_music_recommendations`)
- Tool descriptions follow a consistent `Input:/Output:` format for LLM consumption
- `graphApi()` handles standard Graph API calls; `ruploadApi()` handles rupload.facebook.com uploads; `resumableUpload()` handles local file uploads
- No explicit error handling — Facebook API error responses pass through as-is
- Multi-step video operations (reels, stories) fail at the step that errors — partial state is returned with video_id for retry
- MCP tools return `{ content: [{ type: "text", text: JSON.stringify(data) }] }`
