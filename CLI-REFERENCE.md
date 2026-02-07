# fb CLI Reference

Token-optimized reference for LLM tool use. Binary: `fb` or `facebook`. Output: JSON to stdout.

## Convention

All commands except `pages` take `<page>` (slug from FACEBOOK_ASSETS) as first arg.
Multi-word args (messages, captions) are space-joined from remaining args.
Args in `[brackets]` accept stdin when omitted or replaced with `-`.

## Commands

### Pages
```
fb pages                                    → [{page_name, display_name, fb_page_id}]
```

### Posts
```
fb posts <page>                             → {data: [{id, message, created_time}]}
fb post <page> [message...]                 → {id}
fb post-image <page> <url> [caption...]     → {id, post_id}
fb update-post <page> <post_id> [msg...]    → {success: true}
fb delete-post <page> <post_id>             → {success: true}
fb schedule <page> [msg...] <unix_ts>       → {id}  # last arg = timestamp
```

### Comments
```
fb comments <page> <post_id>                → {data: [{id, message, from, created_time}]}
fb reply <page> <comment_id> [msg...]       → {id}
fb delete-comment <page> <comment_id>       → {success: true}
fb hide-comment <page> <comment_id>         → {success: true}
fb unhide-comment <page> <comment_id>       → {success: true}
fb bulk-delete <page> [id1,id2,...]         → [{comment_id, result, success}]  # uses batch API (max 50/req)
fb bulk-hide <page> [id1,id2,...]           → [{comment_id, result, success}]
```

### Analytics
```
fb insights <page> <post_id>                → {data: [{name, period, values}]}  # all 12 metrics
fb fans <page>                              → {fan_count: N}
fb likes <page> <post_id>                   → {likes: N}
fb shares <page> <post_id>                  → {shares: N}
fb reactions <page> <post_id>               → {post_reactions_like_total: N, ..._love_..., ..._wow_..., ..._haha_..., ..._sorry_..., ..._anger_...}
fb impressions <page> <post_id>             → {data: [{name: "post_impressions", values}]}
fb reach <page> <post_id>                   → {data: [{name: "post_impressions_unique", values}]}
fb clicks <page> <post_id>                  → {data: [{name: "post_clicks", values}]}
fb engaged <page> <post_id>                 → {data: [{name: "post_engaged_users", values}]}
fb top-commenters <page> <post_id>          → [{user_id, count}]  # sorted desc
fb comment-count <page> <post_id>           → {comment_count: N}
```

### Messaging
```
fb dm <page> <user_id> [message...]         → {recipient_id, message_id}
```

### Video & Reels
```
fb publish-reel <page> <url|file> [desc]    → {success, video_id}  # 3-step: init → upload → publish
fb reels <page>                             → {data: [{id, ...}]}
fb video-status <page> <video_id>           → {status: {...}}
fb publish-video <page> <url|file> [title]  → {id}  # --description "..." for description
```

### Stories
```
fb video-story <page> <url|file>            → {success, ...}  # 3-step upload
fb photo-story <page> <photo_url>           → {success, ...}  # 2-step: upload unpublished → publish
fb stories <page>                           → {data: [{id, ...}]}
```

### Slideshows
```
fb slideshow <page> <url1,url2,...>          → {id}  # 3-7 images, --duration 1750, --transition 250
```

### Music
```
fb music [--type popular|new|foryou] [--country US,UK]  → {data: [{id, title, ...}]}
```

### Crossposting
```
fb crosspost <page> <video_id>              → {id}
fb enable-crosspost <page> <vid> <pids,...> → {success: true}
fb crosspost-pages <page>                   → {data: [{id, name, ...}]}
fb crosspost-check <page> <video_id>        → {is_crossposting_eligible: bool}
```

### A/B Testing
```
fb ab-create <page> <name> <goal> <vids,...> <ctrl>  → {id}  # --desc "..." --duration 3600
fb ab-results <page> <test_id>              → {id, name, status, ...}
fb ab-tests <page>                          → {data: [{id, name, ...}]}  # --since DATE --until DATE
fb ab-delete <page> <test_id>               → {success: true}
```

## Stdin Support

Commands with `[brackets]` read from stdin when the arg is omitted or `-`:

```sh
cat draft.txt | fb post mypage              # message from file
echo "Updated" | fb update-post mypage ID   # message from pipe
echo "Thanks!" | fb reply mypage CID        # reply from pipe
echo "Hello" | fb dm mypage UID             # DM from pipe
cat msg.txt | fb schedule mypage 1771069200 # scheduled message from stdin
fb comments mypage PID | jq -r '.data[].id' | fb bulk-hide mypage  # IDs from pipe
```

Bulk commands accept newline-separated, comma-separated, or mixed ID formats from stdin.

## ID Formats

- `post_id`: `{page_id}_{post_id}` (e.g. `907023525836744_1234567890`)
- `comment_id`: `{post_id}_{comment_id}` (e.g. `907023525836744_1234567890_9876543210`)
- `page_name`: lowercase slug from config (e.g. `mybusiness`)

## Composability (jq)

```sh
fb pages | jq '.[].page_name'                          # list page slugs
fb posts mypage | jq '.data[].id'                       # post IDs
fb fans mypage | jq -r '.fan_count'                     # raw number
fb comments mypage POST_ID | jq '.data[] | select(.message | test("spam";"i")) | .id'  # filter
```

## Config

`.env` in cli/ dir:
```
FACEBOOK_ASSETS='[{"fb_page_id":"...","page_name":"...","display_name":"...","page_access_token":"..."}]'
FB_APP_ID=123456789                    # optional — needed for local file uploads
FB_USER_ACCESS_TOKEN=EAA...            # optional — needed for local file uploads
```

Graph API: v22.0
