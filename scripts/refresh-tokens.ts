#!/usr/bin/env bun
/**
 * Refresh Facebook Page tokens and update ~/.claude.json MCP config.
 *
 * Usage:
 *   bun run scripts/refresh-tokens.ts <user_access_token>
 *
 * Get a user access token from https://developers.facebook.com/tools/explorer
 * (with pages_show_list scope), then run this script. It fetches all Pages you
 * manage with their page-specific tokens and writes FACEBOOK_ASSETS into
 * ~/.claude.json for the facebook-mcp server.
 *
 * Restart Claude Desktop after running to pick up the new config.
 */

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const GRAPH_API_VERSION = "v22.0";
const GRAPH_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
const CLAUDE_JSON = join(process.env.HOME!, ".claude.json");
const MCP_SERVER_NAME = "facebook-mcp";

function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

interface FBPage {
  id: string;
  name: string;
  category: string;
  access_token?: string;
}

interface PageAsset {
  fb_page_id: string;
  page_name: string;
  display_name: string;
  page_access_token: string;
}

async function fetchPages(userToken: string): Promise<FBPage[]> {
  const url = new URL(`${GRAPH_URL}/me/accounts`);
  url.searchParams.set("access_token", userToken);
  url.searchParams.set("fields", "id,name,category,access_token");
  url.searchParams.set("limit", "100");

  const res = await fetch(url.toString());
  const data = await res.json() as any;

  if (data.error) {
    die(`API Error: ${data.error.message}`);
  }

  return data.data ?? [];
}

function buildAssets(pages: FBPage[]): PageAsset[] {
  return pages
    .filter((p) => p.access_token)
    .map((p) => ({
      fb_page_id: p.id,
      page_name: slugify(p.name),
      display_name: p.name,
      page_access_token: p.access_token!,
    }));
}

function updateClaudeJson(assets: PageAsset[]): void {
  const raw = readFileSync(CLAUDE_JSON, "utf-8");
  const config = JSON.parse(raw);

  const server = config?.mcpServers?.[MCP_SERVER_NAME];
  if (!server) {
    die(`No '${MCP_SERVER_NAME}' server found in ${CLAUDE_JSON}`);
  }

  const env = (server.env ??= {});
  delete env.FACEBOOK_ACCESS_TOKEN;
  delete env.FACEBOOK_PAGE_ID;
  env.FACEBOOK_ASSETS = JSON.stringify(assets);

  writeFileSync(CLAUDE_JSON, JSON.stringify(config, null, 2) + "\n");
}

// --- Main ---

const args = process.argv.slice(2);
if (args.length !== 1) {
  console.log(`Usage: bun run scripts/refresh-tokens.ts <user_access_token>

Get a user access token from https://developers.facebook.com/tools/explorer
(with pages_show_list scope), then run this script to update ~/.claude.json.`);
  process.exit(1);
}

const userToken = args[0];

console.log(`Fetching pages from Graph API ${GRAPH_API_VERSION}...`);
const pages = await fetchPages(userToken);
console.log(`Found ${pages.length} page(s):`);

const assets = buildAssets(pages);
for (const a of assets) {
  console.log(`  ${a.page_name.padEnd(25)} → ${a.display_name.padEnd(25)} (ID: ${a.fb_page_id})`);
}

const skipped = pages.length - assets.length;
if (skipped) {
  console.log(`  (${skipped} page(s) skipped — no access token returned)`);
}

updateClaudeJson(assets);
console.log(`\nUpdated ${CLAUDE_JSON} with ${assets.length} page(s).`);
console.log("Restart Claude Desktop to pick up the new config.");
