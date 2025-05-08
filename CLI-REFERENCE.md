# fb CLI Reference

Token-optimized reference for LLM tool use. Binary: `fb` or `facebook`. Output: JSON to stdout.

## Convention

All commands except `pages` take `<page>` (slug from FACEBOOK_ASSETS) as first arg.
Multi-word args (messages, captions) are space-joined from remaining args.

## Commands

### Pages
```
fb pages                                    → [{page_name, display_name, fb_page_id}]
```

### Posts
```
fb posts <page>                             → {data: [{id, message, created_time}]}
fb post <page> <message...>                 → {id}
fb post-image <page> <url> <caption...>     → {id, post_id}
fb update-post <page> <post_id> <msg...>    → {success: true}
fb delete-post <page> <post_id>             → {success: true}
fb schedule <page> <msg...> <unix_ts>       → {id}  # last arg = timestamp
```

### Comments
```
fb comments <page> <post_id>                → {data: [{id, message, from, created_time}]}
fb reply <page> <comment_id> <msg...>       → {id}
fb delete-comment <page> <comment_id>       → {success: true}
fb hide-comment <page> <comment_id>         → {success: true}
fb unhide-comment <page> <comment_id>       → {success: true}
fb bulk-delete <page> <id1,id2,...>          → [{comment_id, result}]  # comma-separated, no spaces
fb bulk-hide <page> <id1,id2,...>            → [{comment_id, result}]
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
fb dm <page> <user_id> <message...>         → {recipient_id, message_id}
```

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

`.env` in cli/ dir: `FACEBOOK_ASSETS='[{"fb_page_id":"...","page_name":"...","display_name":"...","page_access_token":"..."}]'`

Graph API: v22.0
