# obsidian-mcp Setup Guide

Self-contained MCP server for your Obsidian vault. Runs on your Mac, accessible remotely via Tailscale.

---

## Architecture

```
Poke / Claude → Tailscale → Mac:3456 → obsidian-mcp → ~/YourVault/
```

No plugins. No Obsidian needing to be open. Just a Node process reading your markdown files directly.

---

## 1. Install & Build

```bash
cd obsidian-mcp
npm install
npm run build
```

---

## 2. Configure

```bash
cp .env.example .env
```

Edit `.env`:

```env
VAULT_PATH=/Users/yourname/Documents/MyVault   # absolute path to vault
PORT=3456
DAILY_NOTE_FOLDER=Journal                        # or Daily, or wherever yours live
AUTH_TOKEN=                                      # optional, leave blank for Tailscale-only auth
```

Test it locally first:

```bash
npm start
# → open http://localhost:3456/health in browser, should return {"status":"ok",...}
```

---

## 3. Tailscale Setup

### Install Tailscale as a system service (not the GUI app)

The GUI app only runs when you're logged in. For a persistent server, use the CLI:

```bash
brew install tailscale
sudo tailscaled &                 # start the daemon
sudo tailscale up                 # authenticate in browser
tailscale ip -4                   # note your Tailscale IP (e.g. 100.x.x.x)
tailscale status                  # confirm it's up
```

Or if you already have the Mac app installed, it handles the daemon for you — just make sure
"Start at Login" is checked in Tailscale preferences.

### Get your stable hostname

Tailscale gives your Mac a stable MagicDNS hostname:
```
your-mac-name.tailnet-name.ts.net
```

Find it at: https://login.tailscale.com/admin/machines

### Test remote access

From another device on your tailnet:
```bash
curl http://your-mac.tailnet-name.ts.net:3456/health
```

---

## 4. Run Persistently with pm2

pm2 keeps the process running after restarts.

```bash
npm install -g pm2

# Start the server
pm2 start dist/index.js --name obsidian-mcp --env production

# Save process list so it survives reboots
pm2 save

# Set up Mac launch agent (runs pm2 on login)
pm2 startup
# → copy/run the command it prints
```

Useful pm2 commands:
```bash
pm2 logs obsidian-mcp      # tail logs
pm2 status                  # check if running
pm2 restart obsidian-mcp   # restart after changes
```

### Auto-start on boot (without login)

If you want it to run even without logging in (headless Mac), use a Launch Daemon instead:

```bash
# Create /Library/LaunchDaemons/com.obsidian-mcp.plist
# with your node + dist/index.js path — ask Claude to generate this file for you
```

---

## 5. Connect in Poke / Claude

In Poke, add an MCP server with:

```
URL: http://your-mac.tailnet-name.ts.net:3456/sse
```

If you set an `AUTH_TOKEN` in `.env`, add a header:
```
Authorization: Bearer your_token_here
```

---

## 6. Available Tools

| Tool | Description |
|------|-------------|
| `list_notes` | List all notes (optional folder filter) |
| `read_note` | Read note content + frontmatter |
| `write_note` | Create or overwrite a note |
| `append_note` | Append to an existing note |
| `delete_note` | Permanently delete a note |
| `search_vault` | Full-text search across vault |
| `list_tags` | All tags + which notes use them |
| `get_daily_note` | Today's (or a specific date's) daily note |
| `create_daily_note` | Create daily note from template |
| `get_sync_status` | Conflict files, recent changes, sync log |

---

## 7. Obsidian Sync Status Notes

`get_sync_status` checks three things without any plugin:

1. **Conflict files** — scans for files with `(conflict)` in the name (how Obsidian Sync marks them)
2. **Recently modified** — files changed in the last 15 minutes (lets you see if sync is actively working)
3. **Sync log** — reads Obsidian's app log at `~/Library/Application Support/obsidian/obsidian.log` and filters for sync-related lines

The log approach works best when Obsidian is actually running. If you need more granular sync status, you'd need the Local REST API plugin — but for most purposes (detecting conflicts, seeing what's been touched) this covers it.

---

## Updating

```bash
npm run build
pm2 restart obsidian-mcp
```
