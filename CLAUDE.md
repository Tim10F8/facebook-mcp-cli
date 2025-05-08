# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A TypeScript MCP (Model Context Protocol) server for automating Facebook Page management via the Facebook Graph API. Exposes 30+ tools for posting, comment moderation, analytics, and engagement tracking to Claude Desktop and other LLM agents. Includes a standalone CLI for direct shell access.

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

**src/config.ts** — `PageAsset` interface, `GRAPH_API_BASE` constant, `loadAssets()` function that parses `FACEBOOK_ASSETS` from environment. Bun auto-loads `.env` from CWD.

**src/api.ts** — `graphApi(method, endpoint, token, params?, body?)` function. Single point for all Graph API HTTP calls using native `fetch`. Returns `response.json()` directly.

**src/server.ts** — Registers all MCP tools via `McpServer.tool()` from `@modelcontextprotocol/sdk`. Builds a page registry from `loadAssets()`, keyed by `page_name`. Each tool resolves the page, calls `graphApi()`, and returns JSON content. Notable business logic:
- `filter_negative_comments` — keyword-based sentiment filtering (7 hardcoded keywords)
- `get_post_top_commenters` — manual counting/sorting of comment authors
- `get_post_reactions_breakdown` — transforms raw insights API response into a flat dict
- `bulk_delete_comments` / `bulk_hide_comments` — sequential loops over individual API calls

### CLI (`cli/`)

Self-contained standalone CLI at `cli/fbcli.ts`. Reads its own `.env` file from the cli/ directory. Uses the same Graph API patterns but is independent of the MCP server code.

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

- All tool functions take `page_name: string` as the first parameter (except `list_pages`)
- Tool descriptions follow a consistent `Input:/Output:` format for LLM consumption
- The `graphApi()` function in `src/api.ts` is the single point for all HTTP calls
- No explicit error handling — Facebook API error responses pass through as-is
- MCP tools return `{ content: [{ type: "text", text: JSON.stringify(data) }] }`
