# Publishing Assessment: obsidian-mcp

**Date:** 2026-02-21  
**Reviewer:** Automated assessment

---

## Summary

`obsidian-mcp` is a standalone MCP (Model Context Protocol) server that exposes an Obsidian vault's markdown files over HTTP/SSE. It is **not** an Obsidian plugin — it's an external Node.js process that reads/writes vault files directly on disk. The project is small (~2 files of real code), well-structured, and close to publishable with some minor work.

**Overall verdict: Ready with minor fixes.** The code is clean, functional, and solves a real need. A few gaps need addressing before open-source release.

---

## Code Quality: ✅ Good

- **TypeScript throughout** with strict mode enabled. Clean types, interfaces exported properly.
- **Architecture is simple and appropriate** — two files (`index.ts` for MCP tool registration + Express server, `vault.ts` for vault operations). No over-engineering.
- **Security considerations present:** Path traversal protection in `resolvePath()` is correctly implemented. Auth middleware supports optional bearer token.
- **Error handling:** Adequate but not comprehensive. Some `catch {}` blocks silently swallow errors (search, tags). Acceptable for a tool like this but could log warnings.
- **No tests.** This is the biggest code quality gap. For open-source, at least basic unit tests for `ObsidianVault` methods would build confidence.
- **Minor issues:**
  - `rootDir` in tsconfig is `./src` but source files are in the root — this would fail to compile as-is. Files need to be moved to `src/` or tsconfig adjusted.
  - The inline tag regex `(?<!\n)#([a-zA-Z][a-zA-Z0-9/_-]*)` has a subtle bug: lookbehind for `\n` doesn't cover tags at the very start of the content string (position 0 after frontmatter). Minor but worth noting.
  - `delete_note` does a hard `fs.unlink` — the tool description says "permanently delete" which is accurate, but Obsidian users expect `.trash/` behavior. Consider offering soft-delete.

---

## Documentation: ✅ Good

- **SETUP.md is excellent** — clear, step-by-step, covers install → build → configure → Tailscale → pm2 → MCP client connection. Well-written with the right level of detail.
- **No README.md.** SETUP.md serves as one, but conventional open-source repos need a `README.md` with: project description, badges, quick start, license, contributing info.
- **.env.example** is clean and well-commented.
- **No API/architecture docs** beyond what's in SETUP.md (the tool table is good).
- **Missing:** CHANGELOG, CONTRIBUTING.md.

---

## Licensing: ❌ Missing

- **No LICENSE file.** This is a hard blocker for open-source publishing. Without a license, the code is "all rights reserved" by default.
- **Recommendation:** MIT or ISC for a utility like this. Add a `LICENSE` file and a `license` field in `package.json`.

---

## Completeness: ⚠️ Nearly Complete

- The tool set is practical and covers the common vault operations (CRUD, search, tags, daily notes, sync status).
- **Missing features that users will ask for:**
  - No support for Obsidian links/backlinks resolution (`[[wikilinks]]`)
  - No rename/move note tool
  - No attachment handling (images, PDFs)
- **Build issue:** Source files are in the root but tsconfig expects `src/`. Need to either move files to `src/` or fix tsconfig.
- **No `npm run` script for linting or formatting** — consider adding eslint/prettier configs.

---

## Sensitive Data: ✅ Clean

- **No hardcoded secrets, API keys, or personal paths** in the source code.
- `.env.example` uses placeholder paths (`/Users/yourname/...`) — appropriate.
- SETUP.md references generic Tailscale hostnames — no personal info.
- **No `.gitignore` file.** Must add one before publishing to prevent `.env`, `node_modules/`, `dist/` from being committed.
- **Recommendation:** Also add `.env` to `.gitignore` and document this.

---

## Checklist Before Publishing

| Item | Status | Priority |
|------|--------|----------|
| Add LICENSE file (MIT/ISC) | ❌ Missing | **Blocker** |
| Add .gitignore (.env, node_modules, dist) | ❌ Missing | **Blocker** |
| Add README.md (can adapt from SETUP.md) | ❌ Missing | **High** |
| Fix tsconfig vs file structure mismatch | ❌ Broken | **High** |
| Add `license` field to package.json | ❌ Missing | High |
| Add basic tests | ❌ Missing | Medium |
| Add eslint/prettier config | ❌ Missing | Low |
| Consider soft-delete (`.trash/`) for delete_note | ⚠️ Nice-to-have | Low |
| Add CONTRIBUTING.md | ❌ Missing | Low |

---

## Classification

This is **not an Obsidian plugin** (no `manifest.json`, no Obsidian API usage). It's a standalone MCP server. Marketing/positioning should be clear about this — it's for AI/LLM tool use, not for the Obsidian community plugin directory.

**Best publishing venue:** GitHub repo + npm package, promoted in MCP server directories and Obsidian forums as an external integration tool.

---

## Bottom Line

Solid, focused utility with clean code. Needs a license, .gitignore, README, and a tsconfig fix before it's ready to publish. No sensitive data issues. Could be published within an hour of addressing the blockers.
