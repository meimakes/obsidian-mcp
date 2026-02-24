import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync } from 'fs';
import matter from 'gray-matter';
import { glob } from 'glob';
import os from 'os';

export interface NoteResult {
  path: string;
  content: string;
  frontmatter: Record<string, unknown>;
  rawContent: string;
}

export interface SearchResult {
  path: string;
  matches: Array<{ line: number; text: string }>;
}

export interface SyncStatus {
  conflicts: string[];
  recentlyModified: Array<{ path: string; modified: string }>;
  syncLogSnippet?: string;
  syncLogPath?: string;
  vaultStats: {
    totalNotes: number;
    totalFiles: number;
  };
}

export class ObsidianVault {
  private vaultPath: string;
  private dailyNoteFolder: string;
  private dailyNoteDateFormat: string;

  constructor(config: {
    vaultPath: string;
    dailyNoteFolder?: string;
    dailyNoteDateFormat?: string;
  }) {
    this.vaultPath = path.resolve(config.vaultPath);
    this.dailyNoteFolder = config.dailyNoteFolder ?? 'Journal';
    this.dailyNoteDateFormat = config.dailyNoteDateFormat ?? 'YYYY-MM-DD';

    if (!existsSync(this.vaultPath)) {
      throw new Error(`Vault path does not exist: ${this.vaultPath}`);
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private resolvePath(notePath: string): string {
    const resolved = path.resolve(this.vaultPath, notePath);
    // Security: ensure we stay within the vault
    if (!resolved.startsWith(this.vaultPath)) {
      throw new Error(`Path traversal attempt blocked: ${notePath}`);
    }
    return resolved;
  }

  private formatDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // ─── Notes ───────────────────────────────────────────────────────────────────

  async listNotes(folder?: string): Promise<string[]> {
    const base = folder ? this.resolvePath(folder) : this.vaultPath;
    const files = await glob('**/*.md', {
      cwd: base,
      ignore: ['**/.obsidian/**', '**/.trash/**'],
    });
    return files.sort().map(f => (folder ? path.join(folder, f) : f));
  }

  async readNote(notePath: string): Promise<NoteResult> {
    const fullPath = this.resolvePath(notePath);
    const rawContent = await fs.readFile(fullPath, 'utf-8');
    const { data: frontmatter, content } = matter(rawContent);
    return { path: notePath, content, frontmatter, rawContent };
  }

  async writeNote(
    notePath: string,
    content: string,
    frontmatter?: Record<string, unknown>
  ): Promise<{ path: string; created: boolean }> {
    const fullPath = this.resolvePath(notePath);
    const exists = existsSync(fullPath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    const output = frontmatter
      ? matter.stringify(content, frontmatter as Record<string, string>)
      : content;
    await fs.writeFile(fullPath, output, 'utf-8');
    return { path: notePath, created: !exists };
  }

  async appendNote(notePath: string, content: string): Promise<void> {
    const fullPath = this.resolvePath(notePath);
    if (!existsSync(fullPath)) {
      throw new Error(`Note not found: ${notePath}`);
    }
    const separator = content.startsWith('\n') ? '' : '\n';
    await fs.appendFile(fullPath, separator + content, 'utf-8');
  }

  async deleteNote(notePath: string): Promise<void> {
    const fullPath = this.resolvePath(notePath);
    await fs.unlink(fullPath);
  }

  // ─── Search ──────────────────────────────────────────────────────────────────

  async searchVault(
    query: string,
    options: { folder?: string; caseSensitive?: boolean; maxResults?: number } = {}
  ): Promise<SearchResult[]> {
    const { folder, caseSensitive = false, maxResults = 20 } = options;
    const notes = await this.listNotes(folder);
    const results: SearchResult[] = [];
    const queryTest = caseSensitive ? query : query.toLowerCase();

    for (const notePath of notes) {
      if (results.length >= maxResults) break;
      try {
        const { rawContent } = await this.readNote(notePath);
        const lines = rawContent.split('\n');
        const matches: Array<{ line: number; text: string }> = [];

        lines.forEach((line, i) => {
          const testLine = caseSensitive ? line : line.toLowerCase();
          if (testLine.includes(queryTest)) {
            matches.push({ line: i + 1, text: line.trim() });
          }
        });

        if (matches.length > 0) {
          results.push({ path: notePath, matches: matches.slice(0, 10) });
        }
      } catch {
        // skip unreadable files
      }
    }

    return results;
  }

  // ─── Tags ────────────────────────────────────────────────────────────────────

  async listTags(): Promise<Record<string, string[]>> {
    const notes = await this.listNotes();
    const tagMap: Record<string, string[]> = {};

    for (const notePath of notes) {
      try {
        const { frontmatter, content } = await this.readNote(notePath);
        const tags: string[] = [];

        // Frontmatter tags (supports both array and string)
        if (frontmatter.tags) {
          const fmTags = Array.isArray(frontmatter.tags)
            ? frontmatter.tags
            : String(frontmatter.tags).split(',').map(t => t.trim());
          tags.push(...fmTags.filter(Boolean));
        }

        // Inline #tags (excludes #headings by checking they're not at line start)
        const inlineMatches = content.matchAll(/(?<!\n)#([a-zA-Z][a-zA-Z0-9/_-]*)/g);
        for (const match of inlineMatches) {
          tags.push(match[1]);
        }

        for (const tag of tags) {
          if (!tagMap[tag]) tagMap[tag] = [];
          if (!tagMap[tag].includes(notePath)) tagMap[tag].push(notePath);
        }
      } catch {
        // skip unreadable files
      }
    }

    return Object.fromEntries(
      Object.entries(tagMap).sort(([a], [b]) => a.localeCompare(b))
    );
  }

  // ─── Daily Notes ─────────────────────────────────────────────────────────────

  getDailyNotePath(date: Date = new Date()): string {
    const dateStr = this.formatDate(date);
    return path.join(this.dailyNoteFolder, `${dateStr}.md`);
  }

  async getDailyNote(dateStr?: string): Promise<{
    path: string;
    exists: boolean;
    note?: NoteResult;
  }> {
    const date = dateStr ? new Date(dateStr) : new Date();
    const notePath = this.getDailyNotePath(date);
    const fullPath = this.resolvePath(notePath);

    if (!existsSync(fullPath)) {
      return { path: notePath, exists: false };
    }

    const note = await this.readNote(notePath);
    return { path: notePath, exists: true, note };
  }

  async createDailyNote(
    options: { dateStr?: string; template?: string; overwrite?: boolean } = {}
  ): Promise<{ path: string; created: boolean }> {
    const { dateStr, template, overwrite = false } = options;
    const date = dateStr ? new Date(dateStr) : new Date();
    const formattedDate = this.formatDate(date);
    const notePath = this.getDailyNotePath(date);
    const fullPath = this.resolvePath(notePath);

    if (existsSync(fullPath) && !overwrite) {
      return { path: notePath, created: false };
    }

    const content = template
      ? template
          .replace(/{{date}}/g, formattedDate)
          .replace(/{{title}}/g, formattedDate)
      : `# ${formattedDate}\n\n## Notes\n\n## Tasks\n\n`;

    return this.writeNote(notePath, content, {
      date: formattedDate,
      created: new Date().toISOString(),
    });
  }

  // ─── Sync Status ─────────────────────────────────────────────────────────────

  async getSyncStatus(): Promise<SyncStatus> {
    // 1. Find conflict files (Obsidian Sync names them with "(conflict)" suffix)
    const allFiles = await glob('**/*', {
      cwd: this.vaultPath,
      ignore: ['**/.obsidian/**', '**/.trash/**'],
    });

    const conflicts = allFiles.filter(f =>
      /\(conflict\s*\d*\)/i.test(f)
    );

    // 2. Recently modified (last 15 minutes — useful to see if sync is actively working)
    const window = Date.now() - 15 * 60 * 1000;
    const recentlyModified: Array<{ path: string; modified: string }> = [];

    for (const file of allFiles.filter(f => f.endsWith('.md'))) {
      try {
        const stat = await fs.stat(path.join(this.vaultPath, file));
        if (stat.mtimeMs > window) {
          recentlyModified.push({
            path: file,
            modified: stat.mtime.toISOString(),
          });
        }
      } catch {
        // skip
      }
    }

    recentlyModified.sort((a, b) => b.modified.localeCompare(a.modified));

    // 3. Try to read Obsidian's sync log (macOS path)
    let syncLogSnippet: string | undefined;
    let syncLogPath: string | undefined;

    const candidateLogs = [
      // macOS Obsidian app log
      path.join(os.homedir(), 'Library/Application Support/obsidian/obsidian.log'),
      // Some versions write here
      path.join(os.homedir(), 'Library/Logs/obsidian/obsidian.log'),
      // Vault-level sync debug file (rare but exists in some setups)
      path.join(this.vaultPath, '.obsidian', 'sync-log.txt'),
    ];

    for (const logPath of candidateLogs) {
      if (existsSync(logPath)) {
        syncLogPath = logPath;
        try {
          const raw = await fs.readFile(logPath, 'utf-8');
          const lines = raw.split('\n');
          // Grab last 30 lines that mention sync
          const syncLines = lines
            .filter(l => /sync|upload|download|conflict|pull|push/i.test(l))
            .slice(-30);
          if (syncLines.length > 0) {
            syncLogSnippet = syncLines.join('\n');
          }
        } catch {
          // log not readable
        }
        break;
      }
    }

    // 4. Basic vault stats
    const mdFiles = allFiles.filter(f => f.endsWith('.md'));

    return {
      conflicts,
      recentlyModified,
      syncLogSnippet,
      syncLogPath,
      vaultStats: {
        totalNotes: mdFiles.length,
        totalFiles: allFiles.length,
      },
    };
  }
}
