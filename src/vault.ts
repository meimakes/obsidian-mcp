import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync, realpathSync } from 'fs';
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

export interface WriteResult {
  path: string;
  created: boolean;
  backedUp?: boolean;
  backupPath?: string;
}

export interface EditResult {
  path: string;
  backedUp: boolean;
  backupPath?: string;
}

export interface DeleteResult {
  path: string;
  trashPath?: string;
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

  // #5: Path traversal protection with symlink resolution
  private resolvePath(notePath: string): string {
    const resolved = path.resolve(this.vaultPath, notePath);

    // First check: resolved path must be within vault
    if (!resolved.startsWith(this.vaultPath + path.sep) && resolved !== this.vaultPath) {
      throw new Error(`Path traversal attempt blocked: ${notePath}`);
    }

    // Second check: resolve symlinks and verify the real path is still inside the vault.
    // For existing files, check the file itself. For new files, check the parent directory
    // (a symlinked directory could redirect writes outside the vault).
    const targetToCheck = existsSync(resolved) ? resolved : path.dirname(resolved);
    if (existsSync(targetToCheck)) {
      const realPath = realpathSync(targetToCheck);
      if (!realPath.startsWith(this.vaultPath + path.sep) && realPath !== this.vaultPath) {
        throw new Error(`Symlink escape blocked: ${notePath} resolves to ${realPath}`);
      }
    }

    return resolved;
  }

  private formatDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayName = days[date.getDay()];

    switch (this.dailyNoteDateFormat) {
      case 'MM-DD-YYYY DayOfWeek':
        return `${m}-${d}-${y} ${dayName}`;
      case 'MM-DD-YYYY':
        return `${m}-${d}-${y}`;
      case 'YYYY-MM-DD':
      default:
        return `${y}-${m}-${d}`;
    }
  }

  /** Parse a date string back from the configured format */
  private parseFormattedDate(dateStr: string): Date | null {
    // Try MM-DD-YYYY DayOfWeek format
    const mdyDay = dateStr.match(/^(\d{2})-(\d{2})-(\d{4})\s+\w+$/);
    if (mdyDay) return new Date(`${mdyDay[3]}-${mdyDay[1]}-${mdyDay[2]}T12:00:00`);

    // Try MM-DD-YYYY format
    const mdy = dateStr.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (mdy) return new Date(`${mdy[3]}-${mdy[1]}-${mdy[2]}T12:00:00`);

    // Try YYYY-MM-DD format
    const ymd = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (ymd) return new Date(`${ymd[1]}-${ymd[2]}-${ymd[3]}T12:00:00`);

    return null;
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

  // #2: Overwrite protection + automatic backup
  async writeNote(
    notePath: string,
    content: string,
    frontmatter?: Record<string, unknown>,
    options: { overwrite?: boolean } = {}
  ): Promise<WriteResult> {
    const fullPath = this.resolvePath(notePath);
    const exists = existsSync(fullPath);

    // Block overwriting existing notes without explicit flag
    if (exists && !options.overwrite) {
      throw new Error(
        `Note already exists: ${notePath}. Set overwrite: true to replace (a backup will be created).`
      );
    }

    // Create backup before overwriting
    let backedUp = false;
    let backupPath: string | undefined;
    if (exists && options.overwrite) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      backupPath = `${notePath}.${timestamp}.bak`;
      const fullBackupPath = path.resolve(this.vaultPath, backupPath);
      await fs.copyFile(fullPath, fullBackupPath);
      backedUp = true;
    }

    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    const output = frontmatter
      ? matter.stringify(content, frontmatter as Record<string, string>)
      : content;
    await fs.writeFile(fullPath, output, 'utf-8');
    return { path: notePath, created: !exists, backedUp, backupPath };
  }

  async appendNote(notePath: string, content: string): Promise<void> {
    const fullPath = this.resolvePath(notePath);
    if (!existsSync(fullPath)) {
      throw new Error(`Note not found: ${notePath}`);
    }
    const separator = content.startsWith('\n') ? '' : '\n';
    await fs.appendFile(fullPath, separator + content, 'utf-8');
  }

  async editNote(
    notePath: string,
    oldText: string,
    newText: string
  ): Promise<EditResult> {
    const fullPath = this.resolvePath(notePath);

    if (!existsSync(fullPath)) {
      throw new Error(`Note not found: ${notePath}`);
    }

    const rawContent = await fs.readFile(fullPath, 'utf-8');

    // Count occurrences — old_text must be unique
    let count = 0;
    let searchFrom = 0;
    while (true) {
      const idx = rawContent.indexOf(oldText, searchFrom);
      if (idx === -1) break;
      count++;
      searchFrom = idx + oldText.length;
    }

    if (count === 0) {
      throw new Error(
        `edit_note failed: old_text not found in ${notePath}. Make sure the text matches exactly (including whitespace and newlines).`
      );
    }

    if (count > 1) {
      throw new Error(
        `edit_note failed: old_text appears ${count} times in ${notePath}. Include more surrounding context to make it unique.`
      );
    }

    // Backup before editing
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${notePath}.${timestamp}.bak`;
    const fullBackupPath = path.resolve(this.vaultPath, backupPath);
    await fs.copyFile(fullPath, fullBackupPath);

    const updatedContent = rawContent.replace(oldText, newText);
    await fs.writeFile(fullPath, updatedContent, 'utf-8');

    return { path: notePath, backedUp: true, backupPath };
  }

  // #1: Soft-delete to .trash/ by default
  async deleteNote(
    notePath: string,
    options: { permanent?: boolean } = {}
  ): Promise<DeleteResult> {
    const fullPath = this.resolvePath(notePath);

    if (!existsSync(fullPath)) {
      throw new Error(`Note not found: ${notePath}`);
    }

    if (options.permanent) {
      await fs.unlink(fullPath);
      return { path: notePath };
    }

    // Soft delete: move to .trash/ (Obsidian convention)
    const trashDir = path.join(this.vaultPath, '.trash');
    await fs.mkdir(trashDir, { recursive: true });

    const basename = path.basename(notePath);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const trashName = `${basename.replace('.md', '')}.${timestamp}.md`;
    const trashFullPath = path.join(trashDir, trashName);

    await fs.rename(fullPath, trashFullPath);
    const trashRelPath = path.relative(this.vaultPath, trashFullPath);
    return { path: notePath, trashPath: trashRelPath };
  }

  // ─── Attachments ─────────────────────────────────────────────────────────────

  async uploadAttachment(
    filePath: string,
    data: Buffer,
    options: { overwrite?: boolean } = {}
  ): Promise<{ path: string; bytes: number }> {
    const resolved = this.resolvePath(filePath);

    if (existsSync(resolved) && !options.overwrite) {
      throw new Error(`File already exists: ${filePath}. Set overwrite: true to replace.`);
    }

    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, data);
    return { path: filePath, bytes: data.length };
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
      } catch (err) {
        // #9: Log errors instead of swallowing silently
        console.warn(`[search] Error reading ${notePath}:`, (err as Error).message);
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
      } catch (err) {
        // #9: Log errors instead of swallowing silently
        console.warn(`[tags] Error reading ${notePath}:`, (err as Error).message);
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

  /** Parse a date string input, avoiding timezone pitfalls */
  private parseDateInput(dateStr: string): Date {
    const parsed = this.parseFormattedDate(dateStr);
    if (parsed) return parsed;
    // For bare YYYY-MM-DD strings, append T12:00:00 to avoid UTC midnight → previous day in local tz
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return new Date(`${dateStr}T12:00:00`);
    }
    return new Date(dateStr);
  }

  async getDailyNote(dateStr?: string): Promise<{
    path: string;
    exists: boolean;
    note?: NoteResult;
  }> {
    const date = dateStr ? this.parseDateInput(dateStr) : new Date();
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
    const date = dateStr ? this.parseDateInput(dateStr) : new Date();
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
      : '';

    return this.writeNote(notePath, content, undefined, { overwrite: true });
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
    // #10: Log content is displayed but is low-risk (no user-supplied data injection)
    let syncLogSnippet: string | undefined;
    let syncLogPath: string | undefined;

    const candidateLogs = [
      path.join(os.homedir(), 'Library/Application Support/obsidian/obsidian.log'),
      path.join(os.homedir(), 'Library/Logs/obsidian/obsidian.log'),
      path.join(this.vaultPath, '.obsidian', 'sync-log.txt'),
    ];

    for (const logPath of candidateLogs) {
      if (existsSync(logPath)) {
        syncLogPath = logPath;
        try {
          const raw = await fs.readFile(logPath, 'utf-8');
          const lines = raw.split('\n');
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
