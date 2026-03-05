# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MCP server that exposes three tools (`query`, `set`, `add`) for reading and writing JSON translation files. Built with the official `@modelcontextprotocol/sdk` and stdio transport. Translation keys use dot-notation (e.g. `Users.name`). The server auto-discovers `{locale}.json` files in the configured directory.

## Commands

```bash
pnpm build                          # Compile TypeScript to dist/
pnpm test                           # Run Vitest tests
pnpm test:watch                     # Watch mode tests
pnpm dev                            # tsc --watch
npx vitest run src/translations.test.ts -t "sets a value"  # Run a single test by name
```

## Architecture

- `src/translations.ts` — Pure functions for file I/O and nested key operations. No MCP dependency.
- `src/index.ts` — MCP server entrypoint. Registers tools using `server.registerTool()` and wires them to the translation functions.
- `src/translations.test.ts` — Tests for the core logic. Each test creates a temp directory with fixture JSON files.

The server takes two CLI arguments: a required translations directory path and an optional base locale (default: `nl`).

## Conventions

- Use `server.registerTool()` (not the deprecated `server.tool()`)
- Keep `translations.ts` free of MCP imports — it should remain usable standalone
- Tests use real filesystem (temp dirs), no mocks
- JSON files are written with 4-space indentation and a trailing newline
- Curly/smart quotes are sanitized to straight quotes on write
