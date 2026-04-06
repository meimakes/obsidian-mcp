import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FilesystemBackend } from './filesystem.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import os from 'os';

let tmpDir: string;
let backend: FilesystemBackend;

async function writeFile(relPath: string, content: string) {
  const fullPath = path.join(tmpDir, relPath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, 'utf-8');
}

async function readFile(relPath: string): Promise<string> {
  return fs.readFile(path.join(tmpDir, relPath), 'utf-8');
}

async function fileExists(relPath: string): Promise<boolean> {
  try {
    await fs.access(path.join(tmpDir, relPath));
    return true;
  } catch {
    return false;
  }
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'obsidian-mcp-test-'));
  backend = new FilesystemBackend({ vaultPath: tmpDir });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ─── Constructor ─────────────────────────────────────────────────────────────

describe('FilesystemBackend constructor', () => {
  it('throws if vault path does not exist', () => {
    expect(() => new FilesystemBackend({ vaultPath: '/nonexistent/path' }))
      .toThrow('Vault path does not exist');
  });

  it('accepts a valid vault path', () => {
    expect(() => new FilesystemBackend({ vaultPath: tmpDir })).not.toThrow();
  });
});

// ─── listNotes ───────────────────────────────────────────────────────────────

describe('listNotes', () => {
  it('returns empty array for empty vault', async () => {
    expect(await backend.listNotes()).toEqual([]);
  });

  it('lists markdown files', async () => {
    await writeFile('note1.md', '# Note 1');
    await writeFile('folder/note2.md', '# Note 2');
    const notes = await backend.listNotes();
    expect(notes).toContain('note1.md');
    expect(notes).toContain('folder/note2.md');
  });

  it('excludes .obsidian and .trash directories', async () => {
    await writeFile('note.md', 'content');
    await writeFile('.obsidian/config.md', 'config');
    await writeFile('.trash/deleted.md', 'deleted');
    const notes = await backend.listNotes();
    expect(notes).toEqual(['note.md']);
  });

  it('filters by folder', async () => {
    await writeFile('root.md', 'root');
    await writeFile('journal/day1.md', 'day1');
    await writeFile('journal/day2.md', 'day2');
    const notes = await backend.listNotes('journal');
    expect(notes).toHaveLength(2);
    expect(notes.every(n => n.startsWith('journal/'))).toBe(true);
  });
});

// ─── readNote ────────────────────────────────────────────────────────────────

describe('readNote', () => {
  it('reads markdown content', async () => {
    await writeFile('test.md', '# Hello\nWorld');
    const result = await backend.readNote('test.md');
    expect(result.path).toBe('test.md');
    expect(result.content).toContain('# Hello');
    expect(result.rawContent).toBe('# Hello\nWorld');
  });

  it('parses frontmatter', async () => {
    await writeFile('fm.md', '---\ntitle: Test\ntags:\n  - a\n  - b\n---\nBody');
    const result = await backend.readNote('fm.md');
    expect(result.frontmatter.title).toBe('Test');
    expect(result.frontmatter.tags).toEqual(['a', 'b']);
    expect(result.content).toContain('Body');
  });

  it('throws for non-existent note', async () => {
    await expect(backend.readNote('missing.md')).rejects.toThrow();
  });

  it('blocks path traversal', async () => {
    await expect(backend.readNote('../etc/passwd')).rejects.toThrow('Path traversal');
  });
});

// ─── writeNote ───────────────────────────────────────────────────────────────

describe('writeNote', () => {
  it('creates a new note', async () => {
    const result = await backend.writeNote('new.md', '# New');
    expect(result.created).toBe(true);
    expect(result.path).toBe('new.md');
    expect(await readFile('new.md')).toBe('# New');
  });

  it('creates parent directories', async () => {
    await backend.writeNote('deep/nested/note.md', 'content');
    expect(await readFile('deep/nested/note.md')).toBe('content');
  });

  it('writes with frontmatter', async () => {
    await backend.writeNote('fm.md', 'body', { title: 'Hello' });
    const content = await readFile('fm.md');
    expect(content).toContain('title: Hello');
    expect(content).toContain('body');
  });

  it('rejects overwrite without flag', async () => {
    await writeFile('existing.md', 'original');
    await expect(backend.writeNote('existing.md', 'new'))
      .rejects.toThrow('Note already exists');
  });

  it('overwrites with flag and creates backup', async () => {
    await writeFile('existing.md', 'original');
    const result = await backend.writeNote('existing.md', 'updated', undefined, { overwrite: true });
    expect(result.created).toBe(false);
    expect(result.backedUp).toBe(true);
    expect(result.backupPath).toMatch(/existing\.md\.\d{4}-\d{2}.*\.bak$/);
    expect(await readFile('existing.md')).toBe('updated');
  });
});

// ─── appendNote ──────────────────────────────────────────────────────────────

describe('appendNote', () => {
  it('appends content to existing note', async () => {
    await writeFile('note.md', 'line1');
    await backend.appendNote('note.md', 'line2');
    expect(await readFile('note.md')).toBe('line1\nline2');
  });

  it('does not double newline when content starts with newline', async () => {
    await writeFile('note.md', 'line1');
    await backend.appendNote('note.md', '\nline2');
    expect(await readFile('note.md')).toBe('line1\nline2');
  });

  it('throws for non-existent note', async () => {
    await expect(backend.appendNote('missing.md', 'text')).rejects.toThrow('Note not found');
  });
});

// ─── deleteNote ──────────────────────────────────────────────────────────────

describe('deleteNote', () => {
  it('soft-deletes to .trash/', async () => {
    await writeFile('doomed.md', 'content');
    const result = await backend.deleteNote('doomed.md');
    expect(result.trashPath).toMatch(/^\.trash\//);
    expect(await fileExists('doomed.md')).toBe(false);
    expect(await fileExists(result.trashPath!)).toBe(true);
  });

  it('permanently deletes with flag', async () => {
    await writeFile('doomed.md', 'content');
    const result = await backend.deleteNote('doomed.md', { permanent: true });
    expect(result.trashPath).toBeUndefined();
    expect(await fileExists('doomed.md')).toBe(false);
  });

  it('throws for non-existent note', async () => {
    await expect(backend.deleteNote('missing.md')).rejects.toThrow('Note not found');
  });
});

// ─── searchVault ─────────────────────────────────────────────────────────────

describe('searchVault', () => {
  beforeEach(async () => {
    await writeFile('a.md', 'Hello world\nfoo bar');
    await writeFile('b.md', 'Goodbye world\nbaz');
    await writeFile('c.md', 'Nothing here');
  });

  it('finds matching notes', async () => {
    const results = await backend.searchVault('world');
    expect(results).toHaveLength(2);
    expect(results.map(r => r.path).sort()).toEqual(['a.md', 'b.md']);
  });

  it('returns line numbers', async () => {
    const results = await backend.searchVault('foo');
    expect(results).toHaveLength(1);
    expect(results[0].matches[0].line).toBe(2);
    expect(results[0].matches[0].text).toBe('foo bar');
  });

  it('case insensitive by default', async () => {
    const results = await backend.searchVault('HELLO');
    expect(results).toHaveLength(1);
  });

  it('respects case sensitive flag', async () => {
    const results = await backend.searchVault('HELLO', { caseSensitive: true });
    expect(results).toHaveLength(0);
  });

  it('respects maxResults', async () => {
    const results = await backend.searchVault('world', { maxResults: 1 });
    expect(results).toHaveLength(1);
  });

  it('filters by folder', async () => {
    await writeFile('sub/d.md', 'Hello world');
    const results = await backend.searchVault('world', { folder: 'sub' });
    expect(results).toHaveLength(1);
    expect(results[0].path).toBe('sub/d.md');
  });
});

// ─── listTags ────────────────────────────────────────────────────────────────

describe('listTags', () => {
  it('finds frontmatter tags', async () => {
    await writeFile('tagged.md', '---\ntags:\n  - project\n  - work\n---\nContent');
    const tags = await backend.listTags();
    expect(tags['project']).toEqual(['tagged.md']);
    expect(tags['work']).toEqual(['tagged.md']);
  });

  it('finds inline tags', async () => {
    await writeFile('inline.md', 'Some text #idea and #todo here');
    const tags = await backend.listTags();
    expect(tags['idea']).toEqual(['inline.md']);
    expect(tags['todo']).toEqual(['inline.md']);
  });

  it('returns empty object for no tags', async () => {
    await writeFile('plain.md', 'No tags here');
    const tags = await backend.listTags();
    expect(Object.keys(tags)).toHaveLength(0);
  });
});

// ─── Daily Notes ─────────────────────────────────────────────────────────────

describe('getDailyNote', () => {
  it('returns exists=false for missing daily note', async () => {
    const result = await backend.getDailyNote('2025-01-15');
    expect(result.exists).toBe(false);
    expect(result.path).toBe('Journal/2025-01-15.md');
  });

  it('returns note when it exists', async () => {
    await writeFile('Journal/2025-01-15.md', '# Jan 15');
    const result = await backend.getDailyNote('2025-01-15');
    expect(result.exists).toBe(true);
    expect(result.note?.content).toContain('# Jan 15');
  });
});

describe('createDailyNote', () => {
  it('creates daily note with template', async () => {
    const result = await backend.createDailyNote({
      dateStr: '2025-06-15',
      template: '# {{date}}\n\nToday is {{title}}',
    });
    expect(result.created).toBe(true);
    const content = await readFile('Journal/2025-06-15.md');
    expect(content).toContain('# 2025-06-15');
    expect(content).toContain('Today is 2025-06-15');
  });

  it('returns created=false if note already exists', async () => {
    await writeFile('Journal/2025-01-15.md', 'existing');
    const result = await backend.createDailyNote({ dateStr: '2025-01-15' });
    expect(result.created).toBe(false);
  });
});

// ─── Date format variants ────────────────────────────────────────────────────

describe('date format variants', () => {
  it('supports MM-DD-YYYY format', async () => {
    const b = new FilesystemBackend({
      vaultPath: tmpDir,
      dailyNoteDateFormat: 'MM-DD-YYYY',
    });
    const result = await b.getDailyNote('2025-06-15');
    expect(result.path).toBe('Journal/06-15-2025.md');
  });
});

// ─── getSyncStatus ───────────────────────────────────────────────────────────

describe('getSyncStatus', () => {
  it('returns vault stats', async () => {
    await writeFile('note1.md', 'a');
    await writeFile('note2.md', 'b');
    await writeFile('image.png', 'img');
    const status = await backend.getSyncStatus();
    expect(status.vaultStats.totalNotes).toBe(2);
    expect(status.vaultStats.totalFiles).toBe(3);
  });

  it('detects conflict files', async () => {
    await writeFile('note (conflict 1).md', 'conflict');
    const status = await backend.getSyncStatus();
    expect(status.conflicts).toHaveLength(1);
  });

  it('tracks recently modified files', async () => {
    await writeFile('recent.md', 'just now');
    const status = await backend.getSyncStatus();
    expect(status.recentlyModified.length).toBeGreaterThanOrEqual(1);
    expect(status.recentlyModified[0].path).toBe('recent.md');
  });
});
