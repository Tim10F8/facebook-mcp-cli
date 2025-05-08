# fbcli Quickstart

## First Run

```bash
# Check it works
bun run cli/fbcli.ts pages

# See all commands
bun run cli/fbcli.ts --help
```

## Common Patterns

### Create alias (add to ~/.zshrc)

```bash
alias fbcli='bun run /path/to/facebook-mcp-cli/cli/fbcli.ts'
```

### List pages and posts

```bash
fbcli pages
fbcli posts mybusiness
```

### Create and manage posts

```bash
# New post
fbcli post mybusiness "Hello from the CLI!"

# Update existing
fbcli update-post mybusiness 123456_789 "Updated message"

# Schedule for later (Unix timestamp)
fbcli schedule mybusiness "Coming soon!" 1738900800

# Delete
fbcli delete-post mybusiness 123456_789
```

### Comment moderation

```bash
# View comments
fbcli comments mybusiness 123456_789

# Reply
fbcli reply mybusiness 111_222 "Thanks for your comment!"

# Hide spam
fbcli hide-comment mybusiness 111_222

# Bulk operations (comma-separated IDs, no spaces)
fbcli bulk-hide mybusiness 111_222,333_444,555_666
fbcli bulk-delete mybusiness 111_222,333_444
```

### Analytics

```bash
# Quick overview
fbcli insights mybusiness 123456_789

# Specific metrics
fbcli fans mybusiness
fbcli likes mybusiness 123456_789
fbcli reactions mybusiness 123456_789
fbcli reach mybusiness 123456_789
```

### Pipe to jq

```bash
# Extract page names
fbcli pages | jq '.[].page_name'

# Get post IDs
fbcli posts mybusiness | jq '.data[].id'

# Reaction counts as flat object
fbcli reactions mybusiness 123456_789 | jq .

# Fan count as number
fbcli fans mybusiness | jq -r '.fan_count'
```

### Shell scripting

```bash
# Post to all pages
for page in $(fbcli pages | jq -r '.[].page_name'); do
  fbcli post "$page" "New announcement!"
done

# Hide all comments matching a pattern
fbcli comments mybusiness 123456_789 \
  | jq -r '.data[] | select(.message | test("spam"; "i")) | .id' \
  | paste -sd, - \
  | xargs -I{} fbcli bulk-hide mybusiness {}
```
