# obsidian-mcp

Self-contained MCP (Model Context Protocol) server for your Obsidian vault. Runs as a standalone Node.js process — no Obsidian plugins required. Access your vault remotely via Tailscale or any network.

```
Claude / AI Agent → Tailscale → Mac:3456 → obsidian-mcp → ~/YourVault/
```

## Features

- **Full vault CRUD** — list, read, write, append, delete notes
- **Full-text search** across your entire vault
- **Tag management** — list all tags and their associated notes
- **Daily notes** — get or create daily notes with templates
- **Sync status** — detect Obsidian Sync conflicts and recent changes
- **Secure** — optional bearer token auth, path traversal protection
- **HTTP/SSE transport** — works with any MCP-compatible client

## Quick Start

```bash
npm install
npm run build

# Configure
cp .env.example .env
# Edit .env with your vault path

npm start
# → http://localhost:3456/health
```

## Configuration

```env
VAULT_PATH=/Users/yourname/Documents/MyVault
PORT=3456
DAILY_NOTE_FOLDER=Journal
AUTH_TOKEN=              # optional
```

## Available Tools

| Tool | Description |
|------|-------------|
| `list_notes` | List all notes (optional folder filter) |
| `read_note` | Read note content + frontmatter |
| `write_note` | Create or overwrite a note |
| `append_note` | Append to an existing note |
| `delete_note` | Permanently delete a note |
| `search_vault` | Full-text search across vault |
| `list_tags` | All tags + which notes use them |
| `get_daily_note` | Today's (or specific date's) daily note |
| `create_daily_note` | Create daily note from template |
| `get_sync_status` | Conflict files, recent changes, sync log |

## Running Persistently

See [SETUP.md](./SETUP.md) for detailed instructions on:
- Tailscale remote access setup
- pm2 process management
- Launch daemon configuration
- MCP client connection

## License

MIT — see [LICENSE](./LICENSE)
