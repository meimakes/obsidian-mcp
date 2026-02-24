import 'dotenv/config';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import { ObsidianVault } from './vault.js';

// ─── Config ───────────────────────────────────────────────────────────────────

const VAULT_PATH = process.env.VAULT_PATH;
const PORT = parseInt(process.env.PORT ?? '3456', 10);
const DAILY_NOTE_FOLDER = process.env.DAILY_NOTE_FOLDER ?? 'Journal';
const AUTH_TOKEN = process.env.AUTH_TOKEN; // optional bearer token

if (!VAULT_PATH) {
  console.error('❌  VAULT_PATH env var is required');
  process.exit(1);
}

let vault: ObsidianVault;
try {
  vault = new ObsidianVault({
    vaultPath: VAULT_PATH,
    dailyNoteFolder: DAILY_NOTE_FOLDER,
  });
  console.log(`✅  Vault loaded: ${VAULT_PATH}`);
} catch (err) {
  console.error('❌  Failed to initialize vault:', err);
  process.exit(1);
}

// ─── Auth Middleware ───────────────────────────────────────────────────────────

function authMiddleware(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  if (!AUTH_TOKEN) return next(); // no auth configured → open (rely on Tailscale ACLs)
  const header = req.headers.authorization ?? '';
  if (header === `Bearer ${AUTH_TOKEN}`) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

// ─── MCP Server ───────────────────────────────────────────────────────────────

const server = new McpServer({
  name: 'obsidian-mcp',
  version: '1.0.0',
});

// ── list_notes ────────────────────────────────────────────────────────────────
server.tool(
  'list_notes',
  'List all markdown notes in the vault, optionally filtered to a folder',
  { folder: z.string().optional().describe('Subfolder path relative to vault root') },
  async ({ folder }) => {
    const notes = await vault.listNotes(folder);
    return {
      content: [{ type: 'text', text: notes.join('\n') || '(no notes found)' }],
    };
  }
);

// ── read_note ─────────────────────────────────────────────────────────────────
server.tool(
  'read_note',
  'Read the full content and frontmatter of a note',
  { path: z.string().describe('Path to note relative to vault root, e.g. "Journal/2025-01-01.md"') },
  async ({ path }) => {
    const note = await vault.readNote(path);
    const fmStr =
      Object.keys(note.frontmatter).length > 0
        ? `---\n${JSON.stringify(note.frontmatter, null, 2)}\n---\n\n`
        : '';
    return {
      content: [{ type: 'text', text: fmStr + note.content }],
    };
  }
);

// ── write_note ────────────────────────────────────────────────────────────────
server.tool(
  'write_note',
  'Create or overwrite a note. Creates parent folders as needed.',
  {
    path: z.string().describe('Path relative to vault root'),
    content: z.string().describe('Markdown content (excluding frontmatter)'),
    frontmatter: z
      .record(z.unknown())
      .optional()
      .describe('Optional YAML frontmatter as a JSON object'),
  },
  async ({ path, content, frontmatter }) => {
    const result = await vault.writeNote(
      path,
      content,
      frontmatter as Record<string, unknown> | undefined
    );
    return {
      content: [
        {
          type: 'text',
          text: result.created ? `✅ Created: ${result.path}` : `✅ Updated: ${result.path}`,
        },
      ],
    };
  }
);

// ── append_note ───────────────────────────────────────────────────────────────
server.tool(
  'append_note',
  'Append content to the end of an existing note',
  {
    path: z.string().describe('Path relative to vault root'),
    content: z.string().describe('Text to append'),
  },
  async ({ path, content }) => {
    await vault.appendNote(path, content);
    return {
      content: [{ type: 'text', text: `✅ Appended to ${path}` }],
    };
  }
);

// ── delete_note ───────────────────────────────────────────────────────────────
server.tool(
  'delete_note',
  'Permanently delete a note from the vault',
  { path: z.string().describe('Path relative to vault root') },
  async ({ path }) => {
    await vault.deleteNote(path);
    return {
      content: [{ type: 'text', text: `🗑️ Deleted: ${path}` }],
    };
  }
);

// ── search_vault ──────────────────────────────────────────────────────────────
server.tool(
  'search_vault',
  'Full-text search across all notes in the vault',
  {
    query: z.string().describe('Search string'),
    folder: z.string().optional().describe('Limit search to this folder'),
    caseSensitive: z.boolean().optional().default(false),
    maxResults: z.number().optional().default(20),
  },
  async ({ query, folder, caseSensitive, maxResults }) => {
    const results = await vault.searchVault(query, { folder, caseSensitive, maxResults });
    if (results.length === 0) {
      return { content: [{ type: 'text', text: `No results for "${query}"` }] };
    }
    const formatted = results
      .map(
        r =>
          `**${r.path}**\n` +
          r.matches.map(m => `  L${m.line}: ${m.text}`).join('\n')
      )
      .join('\n\n');
    return { content: [{ type: 'text', text: formatted }] };
  }
);

// ── list_tags ─────────────────────────────────────────────────────────────────
server.tool(
  'list_tags',
  'List all tags used in the vault and which notes use each tag',
  {},
  async () => {
    const tags = await vault.listTags();
    const entries = Object.entries(tags);
    if (entries.length === 0) {
      return { content: [{ type: 'text', text: 'No tags found.' }] };
    }
    const formatted = entries
      .map(([tag, paths]) => `#${tag} (${paths.length})\n${paths.map(p => `  - ${p}`).join('\n')}`)
      .join('\n\n');
    return { content: [{ type: 'text', text: formatted }] };
  }
);

// ── get_daily_note ────────────────────────────────────────────────────────────
server.tool(
  'get_daily_note',
  'Get today\'s daily note (or a specific date\'s note)',
  {
    date: z
      .string()
      .optional()
      .describe('ISO date string, e.g. "2025-06-15". Defaults to today.'),
  },
  async ({ date }) => {
    const result = await vault.getDailyNote(date);
    if (!result.exists) {
      return {
        content: [
          {
            type: 'text',
            text: `Daily note not found at ${result.path}. Use create_daily_note to create it.`,
          },
        ],
      };
    }
    const note = result.note!;
    const fmStr =
      Object.keys(note.frontmatter).length > 0
        ? `---\n${JSON.stringify(note.frontmatter, null, 2)}\n---\n\n`
        : '';
    return {
      content: [{ type: 'text', text: fmStr + note.content }],
    };
  }
);

// ── create_daily_note ─────────────────────────────────────────────────────────
server.tool(
  'create_daily_note',
  'Create today\'s daily note (or a specific date\'s note) from a template',
  {
    date: z.string().optional().describe('ISO date string. Defaults to today.'),
    template: z
      .string()
      .optional()
      .describe(
        'Note template. Use {{date}} as a placeholder. Defaults to a standard template.'
      ),
    overwrite: z
      .boolean()
      .optional()
      .default(false)
      .describe('Overwrite if note already exists'),
  },
  async ({ date, template, overwrite }) => {
    const result = await vault.createDailyNote({ dateStr: date, template, overwrite });
    return {
      content: [
        {
          type: 'text',
          text: result.created
            ? `✅ Created daily note: ${result.path}`
            : `ℹ️ Daily note already exists: ${result.path} (use overwrite: true to replace)`,
        },
      ],
    };
  }
);

// ── get_sync_status ───────────────────────────────────────────────────────────
server.tool(
  'get_sync_status',
  'Check Obsidian Sync status — conflicts, recently modified files, and sync log',
  {},
  async () => {
    const status = await vault.getSyncStatus();

    const lines: string[] = [];

    lines.push(`## Vault Stats`);
    lines.push(`- Notes: ${status.vaultStats.totalNotes}`);
    lines.push(`- Total files: ${status.vaultStats.totalFiles}`);
    lines.push('');

    if (status.conflicts.length > 0) {
      lines.push(`## ⚠️ Conflict Files (${status.conflicts.length})`);
      status.conflicts.forEach(c => lines.push(`  - ${c}`));
    } else {
      lines.push('## ✅ No Conflict Files');
    }
    lines.push('');

    if (status.recentlyModified.length > 0) {
      lines.push(`## Recently Modified (last 15 min)`);
      status.recentlyModified.forEach(f =>
        lines.push(`  - ${f.path} — ${new Date(f.modified).toLocaleTimeString()}`)
      );
    } else {
      lines.push('## Recently Modified (last 15 min)\n  (none)');
    }
    lines.push('');

    if (status.syncLogSnippet) {
      lines.push(`## Sync Log (${status.syncLogPath})`);
      lines.push('```');
      lines.push(status.syncLogSnippet);
      lines.push('```');
    } else {
      lines.push('## Sync Log\n  Not found. Obsidian may not be running or log path differs.');
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }
);

// ─── HTTP / SSE Express Server ─────────────────────────────────────────────────

const app = express();
app.use(express.json());

// Health check (unauthenticated — useful for Tailscale uptime monitoring)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', vault: VAULT_PATH, server: 'obsidian-mcp' });
});

// SSE transport — one connection per client
const transports: Record<string, SSEServerTransport> = {};

app.get('/sse', authMiddleware, async (req, res) => {
  console.log(`→ SSE connection from ${req.ip}`);
  const transport = new SSEServerTransport('/messages', res);
  transports[transport.sessionId] = transport;

  res.on('close', () => {
    console.log(`← SSE disconnected: ${transport.sessionId}`);
    delete transports[transport.sessionId];
  });

  await server.connect(transport);
});

app.post('/messages', authMiddleware, async (req, res) => {
  const sessionId = req.query.sessionId as string;
  const transport = transports[sessionId];
  if (!transport) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  await transport.handlePostMessage(req, res);
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🟢  obsidian-mcp running`);
  console.log(`   Port     : ${PORT}`);
  console.log(`   Vault    : ${VAULT_PATH}`);
  console.log(`   Daily    : ${DAILY_NOTE_FOLDER}/`);
  console.log(`   Auth     : ${AUTH_TOKEN ? 'Bearer token enabled' : 'None (Tailscale ACLs only)'}`);
  console.log(`   SSE URL  : http://0.0.0.0:${PORT}/sse\n`);
});
