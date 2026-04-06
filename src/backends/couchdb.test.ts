import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CouchDBBackend } from './couchdb.js';

// Mock the obsidian-sync-mcp Vault class
const mockVault = {
  init: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  readNote: vi.fn(),
  writeNote: vi.fn(),
  deleteNote: vi.fn(),
  listNotes: vi.fn(),
  listNotesWithMtime: vi.fn(),
  getMetadata: vi.fn(),
};

vi.mock('obsidian-sync-mcp/dist/vault-5Y35MEZS.js', () => ({
  Vault: class MockVault {
    constructor() {
      return mockVault;
    }
  },
}));

let backend: CouchDBBackend;

beforeEach(async () => {
  // Reset call history only (preserve mock implementations)
  mockVault.init.mockClear();
  mockVault.close.mockClear();
  mockVault.readNote.mockReset();
  mockVault.writeNote.mockReset();
  mockVault.deleteNote.mockReset();
  mockVault.listNotes.mockReset();
  mockVault.listNotesWithMtime.mockReset();
  mockVault.getMetadata.mockReset();

  mockVault.init.mockResolvedValue(undefined);

  backend = new CouchDBBackend({
    url: 'http://localhost:5984',
    database: 'test-db',
    username: 'admin',
    password: 'password',
  });
  await backend.init();
});

// ─── listNotes ───────────────────────────────────────────────────────────────

describe('listNotes', () => {
  it('returns sorted notes', async () => {
    mockVault.listNotes.mockResolvedValue(['b.md', 'a.md']);
    const notes = await backend.listNotes();
    expect(notes).toEqual(['a.md', 'b.md']);
  });

  it('filters .obsidian and .trash', async () => {
    mockVault.listNotes.mockResolvedValue([
      'note.md',
      '.obsidian/plugins.md',
      '.trash/deleted.md',
      'sub/.obsidian/x.md',
    ]);
    const notes = await backend.listNotes();
    expect(notes).toEqual(['note.md']);
  });

  it('passes folder to underlying vault', async () => {
    mockVault.listNotes.mockResolvedValue(['journal/day1.md']);
    await backend.listNotes('journal');
    expect(mockVault.listNotes).toHaveBeenCalledWith('journal');
  });
});

// ─── readNote ────────────────────────────────────────────────────────────────

describe('readNote', () => {
  it('reads and parses content with frontmatter', async () => {
    mockVault.readNote.mockResolvedValue('---\ntitle: Test\n---\nBody text');
    const result = await backend.readNote('test.md');
    expect(result.path).toBe('test.md');
    expect(result.frontmatter.title).toBe('Test');
    expect(result.content).toContain('Body text');
    expect(result.rawContent).toBe('---\ntitle: Test\n---\nBody text');
  });

  it('throws for non-existent note', async () => {
    mockVault.readNote.mockResolvedValue(null);
    await expect(backend.readNote('missing.md')).rejects.toThrow('Note not found');
  });

  it('validates path', async () => {
    await expect(backend.readNote('../escape.md')).rejects.toThrow('Invalid path');
    await expect(backend.readNote('/absolute.md')).rejects.toThrow('Invalid path');
    await expect(backend.readNote('')).rejects.toThrow('Invalid path');
  });
});

// ─── writeNote ───────────────────────────────────────────────────────────────

describe('writeNote', () => {
  it('creates new note', async () => {
    mockVault.readNote.mockResolvedValue(null);
    mockVault.writeNote.mockResolvedValue(true);
    const result = await backend.writeNote('new.md', '# New');
    expect(result.created).toBe(true);
    expect(mockVault.writeNote).toHaveBeenCalledWith('new.md', '# New');
  });

  it('rejects overwrite without flag', async () => {
    mockVault.readNote.mockResolvedValue('existing content');
    await expect(backend.writeNote('existing.md', 'new'))
      .rejects.toThrow('Note already exists');
  });

  it('overwrites with backup when flag is set', async () => {
    mockVault.readNote.mockResolvedValue('original');
    mockVault.writeNote.mockResolvedValue(true);
    const result = await backend.writeNote('existing.md', 'updated', undefined, { overwrite: true });
    expect(result.created).toBe(false);
    expect(result.backedUp).toBe(true);
    expect(result.backupPath).toMatch(/existing\.md\.\d{4}-\d{2}.*\.bak$/);
    // Should have written backup first, then the note
    expect(mockVault.writeNote).toHaveBeenCalledTimes(2);
  });

  it('writes frontmatter when provided', async () => {
    mockVault.readNote.mockResolvedValue(null);
    mockVault.writeNote.mockResolvedValue(true);
    await backend.writeNote('fm.md', 'body', { title: 'Hello' });
    const writtenContent = mockVault.writeNote.mock.calls[0][1] as string;
    expect(writtenContent).toContain('title: Hello');
    expect(writtenContent).toContain('body');
  });

  it('throws on write failure', async () => {
    mockVault.readNote.mockResolvedValue(null);
    mockVault.writeNote.mockResolvedValue(false);
    await expect(backend.writeNote('fail.md', 'content'))
      .rejects.toThrow('Failed to write note');
  });
});

// ─── appendNote ──────────────────────────────────────────────────────────────

describe('appendNote', () => {
  it('appends to existing note', async () => {
    mockVault.readNote.mockResolvedValue('line1');
    mockVault.writeNote.mockResolvedValue(true);
    await backend.appendNote('note.md', 'line2');
    expect(mockVault.writeNote).toHaveBeenCalledWith('note.md', 'line1\nline2');
  });

  it('does not double newline', async () => {
    mockVault.readNote.mockResolvedValue('line1');
    mockVault.writeNote.mockResolvedValue(true);
    await backend.appendNote('note.md', '\nline2');
    expect(mockVault.writeNote).toHaveBeenCalledWith('note.md', 'line1\nline2');
  });

  it('throws for missing note', async () => {
    mockVault.readNote.mockResolvedValue(null);
    await expect(backend.appendNote('missing.md', 'text')).rejects.toThrow('Note not found');
  });
});

// ─── deleteNote ──────────────────────────────────────────────────────────────

describe('deleteNote', () => {
  it('soft-deletes by writing to .trash and deleting original', async () => {
    mockVault.readNote.mockResolvedValue('content');
    mockVault.writeNote.mockResolvedValue(true);
    mockVault.deleteNote.mockResolvedValue(true);
    const result = await backend.deleteNote('note.md');
    expect(result.trashPath).toMatch(/^\.trash\//);
    // Should write to .trash first
    const trashWriteCall = mockVault.writeNote.mock.calls[0];
    expect(trashWriteCall[0]).toMatch(/^\.trash\//);
    expect(trashWriteCall[1]).toBe('content');
    // Then delete original
    expect(mockVault.deleteNote).toHaveBeenCalledWith('note.md');
  });

  it('permanently deletes without .trash', async () => {
    mockVault.readNote.mockResolvedValue('content');
    mockVault.deleteNote.mockResolvedValue(true);
    const result = await backend.deleteNote('note.md', { permanent: true });
    expect(result.trashPath).toBeUndefined();
    expect(mockVault.writeNote).not.toHaveBeenCalled();
    expect(mockVault.deleteNote).toHaveBeenCalledWith('note.md');
  });

  it('throws for missing note', async () => {
    mockVault.readNote.mockResolvedValue(null);
    await expect(backend.deleteNote('missing.md')).rejects.toThrow('Note not found');
  });
});

// ─── searchVault ─────────────────────────────────────────────────────────────

describe('searchVault', () => {
  it('searches across notes', async () => {
    mockVault.listNotes.mockResolvedValue(['a.md', 'b.md']);
    mockVault.readNote
      .mockResolvedValueOnce('Hello world')
      .mockResolvedValueOnce('Goodbye world');
    const results = await backend.searchVault('world');
    expect(results).toHaveLength(2);
  });

  it('returns line numbers', async () => {
    mockVault.listNotes.mockResolvedValue(['a.md']);
    mockVault.readNote.mockResolvedValueOnce('line1\nHello world\nline3');
    const results = await backend.searchVault('world');
    expect(results[0].matches[0].line).toBe(2);
  });

  it('respects maxResults', async () => {
    mockVault.listNotes.mockResolvedValue(['a.md', 'b.md', 'c.md']);
    mockVault.readNote
      .mockResolvedValueOnce('match')
      .mockResolvedValueOnce('match');
    const results = await backend.searchVault('match', { maxResults: 1 });
    expect(results).toHaveLength(1);
  });
});

// ─── listTags ────────────────────────────────────────────────────────────────

describe('listTags', () => {
  it('finds frontmatter and inline tags', async () => {
    mockVault.listNotes.mockResolvedValue(['tagged.md']);
    mockVault.readNote.mockResolvedValue('---\ntags:\n  - project\n---\nSome #idea here');
    const tags = await backend.listTags();
    expect(tags['project']).toEqual(['tagged.md']);
    expect(tags['idea']).toEqual(['tagged.md']);
  });
});

// ─── Daily Notes ─────────────────────────────────────────────────────────────

describe('getDailyNote', () => {
  it('returns exists=false for missing note', async () => {
    mockVault.readNote.mockResolvedValue(null);
    const result = await backend.getDailyNote('2025-01-15');
    expect(result.exists).toBe(false);
    expect(result.path).toBe('Journal/2025-01-15.md');
  });

  it('returns note when it exists', async () => {
    mockVault.readNote.mockResolvedValue('# Jan 15');
    const result = await backend.getDailyNote('2025-01-15');
    expect(result.exists).toBe(true);
    expect(result.note?.content).toContain('# Jan 15');
  });
});

describe('createDailyNote', () => {
  it('creates note with template substitution', async () => {
    mockVault.readNote.mockResolvedValue(null);
    mockVault.writeNote.mockResolvedValue(true);
    const result = await backend.createDailyNote({
      dateStr: '2025-06-15',
      template: '# {{date}}',
    });
    expect(result.created).toBe(true);
    const written = mockVault.writeNote.mock.calls[0][1] as string;
    expect(written).toBe('# 2025-06-15');
  });

  it('does not overwrite without flag', async () => {
    mockVault.readNote.mockResolvedValue('existing');
    const result = await backend.createDailyNote({ dateStr: '2025-01-15' });
    expect(result.created).toBe(false);
    expect(mockVault.writeNote).not.toHaveBeenCalled();
  });
});

// ─── getSyncStatus ───────────────────────────────────────────────────────────

describe('getSyncStatus', () => {
  it('returns vault stats from CouchDB', async () => {
    mockVault.listNotesWithMtime.mockResolvedValue([
      { path: 'note1.md', mtime: Date.now() },
      { path: 'note2.md', mtime: Date.now() - 20 * 60_000 },
      { path: 'image.png', mtime: Date.now() },
    ]);
    const status = await backend.getSyncStatus();
    expect(status.vaultStats.totalNotes).toBe(2);
    expect(status.vaultStats.totalFiles).toBe(3);
    expect(status.conflicts).toEqual([]);
  });

  it('reports recently modified notes', async () => {
    const recentTime = Date.now() - 5 * 60_000; // 5 min ago
    mockVault.listNotesWithMtime.mockResolvedValue([
      { path: 'recent.md', mtime: recentTime },
      { path: 'old.md', mtime: Date.now() - 30 * 60_000 },
    ]);
    const status = await backend.getSyncStatus();
    expect(status.recentlyModified).toHaveLength(1);
    expect(status.recentlyModified[0].path).toBe('recent.md');
  });
});
