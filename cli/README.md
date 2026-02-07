# fbcli — Facebook Page Management CLI

Standalone shell interface to the Facebook Graph API. Manages posts, comments, analytics, and messaging for one or more Facebook Pages.

## Setup

1. Create `.env` in the cli directory:

```
FACEBOOK_ASSETS='[{"fb_page_id":"123456","page_name":"mybusiness","display_name":"My Business","page_access_token":"EAA..."}]'
```

2. Run:

```bash
bun run cli/fbcli.ts --help
```

Or create an alias:

```bash
alias fbcli='bun run /path/to/facebook-mcp-cli/cli/fbcli.ts'
```

## Config Format

`FACEBOOK_ASSETS` is a JSON array in `.env` (same directory as `fbcli.ts`). Each entry needs:

| Field | Description |
|-------|-------------|
| `fb_page_id` | Facebook Page ID |
| `page_name` | Slug identifier (lowercase, no spaces) — used as first arg in all commands |
| `display_name` | Human-readable label |
| `page_access_token` | Page access token from [Graph API Explorer](https://developers.facebook.com/tools/explorer) |

Multiple pages are supported — add more objects to the array.

## Commands

### Pages

```bash
fbcli pages                              # List all configured pages
```

### Posts

```bash
fbcli posts <page>                       # List recent posts
fbcli post <page> [message]              # Create text post
fbcli post-image <page> <url> [caption]  # Post image with caption
fbcli update-post <page> <post_id> [msg] # Update post message
fbcli delete-post <page> <post_id>       # Delete post
fbcli schedule <page> [msg] <timestamp>  # Schedule future post (Unix timestamp)
```

### Comments

```bash
fbcli comments <page> <post_id>          # List comments on post
fbcli reply <page> <comment_id> [msg]    # Reply to comment
fbcli delete-comment <page> <comment_id> # Delete comment
fbcli hide-comment <page> <comment_id>   # Hide comment
fbcli unhide-comment <page> <comment_id> # Unhide comment
fbcli bulk-delete <page> [id1,id2,...]   # Bulk delete (batch API, max 50/req)
fbcli bulk-hide <page> [id1,id2,...]     # Bulk hide (batch API, max 50/req)
```

### Analytics

```bash
fbcli insights <page> <post_id>          # All insights for post
fbcli fans <page>                        # Page fan count
fbcli likes <page> <post_id>             # Like count
fbcli shares <page> <post_id>            # Share count
fbcli reactions <page> <post_id>         # Reaction breakdown
fbcli impressions <page> <post_id>       # Total impressions
fbcli reach <page> <post_id>             # Unique impressions
fbcli clicks <page> <post_id>            # Click count
fbcli engaged <page> <post_id>           # Engaged users
fbcli top-commenters <page> <post_id>    # Top commenters
fbcli comment-count <page> <post_id>     # Comment count
```

### Messaging

```bash
fbcli dm <page> <user_id> [message]      # Send DM
```

### Video & Reels

```bash
fbcli publish-reel <page> <url|file> [desc]  # Publish Reel (URL or local file)
fbcli reels <page>                           # List Reels
fbcli video-status <page> <video_id>         # Check processing status
fbcli publish-video <page> <url|file> [title]  # Publish video to feed
```

### Stories

```bash
fbcli video-story <page> <url|file>          # Publish video Story
fbcli photo-story <page> <photo_url>         # Publish photo Story
fbcli stories <page>                         # List Stories
```

### Slideshows

```bash
fbcli slideshow <page> <url1,url2,url3,...>  # Create slideshow (3-7 images)
```

### Music

```bash
fbcli music [--type popular|new|foryou]      # Music recommendations
```

### Crossposting

```bash
fbcli crosspost <page> <video_id>            # Crosspost video to page
fbcli enable-crosspost <page> <vid> <pids>   # Enable crossposting
fbcli crosspost-pages <page>                 # List eligible pages
fbcli crosspost-check <page> <video_id>      # Check eligibility
```

### A/B Testing

```bash
fbcli ab-create <page> <name> <goal> <vids> <ctrl>  # Create A/B test
fbcli ab-results <page> <test_id>            # Get test results
fbcli ab-tests <page>                        # List A/B tests
fbcli ab-delete <page> <test_id>             # Delete A/B test
```

## Stdin Support

Commands with `[brackets]` accept input via stdin when the argument is omitted or replaced with `-`. This enables piping and composition:

```bash
# Post from a file
cat draft.txt | fbcli post mybusiness

# Reply with piped message
echo "Thanks for the feedback!" | fbcli reply mybusiness 123_456

# DM from stdin
echo "Hello" | fbcli dm mybusiness 9876543210

# Schedule with message from stdin
cat announcement.txt | fbcli schedule mybusiness 1771069200

# Bulk hide with IDs from another command
fbcli comments mybusiness 123_456 | jq -r '.data[].id' | fbcli bulk-hide mybusiness

# Bulk delete from a file (one ID per line)
cat ids.txt | fbcli bulk-delete mybusiness
```

Bulk commands accept newline-separated, comma-separated, or mixed ID formats from stdin.

## Output

All commands output JSON to stdout. Errors go to stderr. This makes `fbcli` composable with `jq`, pipes, and scripts:

```bash
# Get all page names
fbcli pages | jq '.[].page_name'

# Post IDs only
fbcli posts mybusiness | jq '.data[].id'

# Fan count as raw number
fbcli fans mybusiness | jq '.fan_count'
```

## Graph API

Uses Facebook Graph API **v22.0**. Tokens from [developers.facebook.com/tools/explorer](https://developers.facebook.com/tools/explorer).

## Architecture

Single-file CLI (`fbcli.ts`):
- Config loader reads `FACEBOOK_ASSETS` from `.env` in the cli directory
- `graphApi()` — single `fetch`-based wrapper for all Graph API calls
- `ruploadApi()` — upload wrapper for `rupload.facebook.com` (Reels/Stories)
- `resumableUpload()` — 2-step Resumable Upload API for local file uploads
- `graphApiBatch()` — batch API wrapper (auto-chunks at 50) for bulk operations
- One async function per command
- `switch` router in `main()` dispatches on argv
- JSON output to stdout, errors to stderr
