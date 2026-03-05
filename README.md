# @trivle/i18n-tools-mcp

MCP server for querying and managing JSON translation files. Designed for AI agents (Claude Code, Cursor, etc.) to read and write translations directly through the Model Context Protocol.

## Install

Ask your AI agent:

> Install the @trivle/i18n-tools-mcp MCP server. The translations directory is at ./messages and the base locale is nl.

Or add it manually to your MCP client config (e.g. `.claude/settings.json`):

```json
{
  "mcpServers": {
    "i18n-tools": {
      "command": "npx",
      "args": ["@trivle/i18n-tools-mcp", "./messages", "nl"]
    }
  }
}
```

Arguments:

1. **Required**: Path to the directory containing your translation files
2. **Optional**: Base locale code (default: `nl`) — used in tool descriptions to guide AI agents
3. **Optional**: JSON indentation spaces (default: `4`)

## Directory structures

Both flat and namespaced layouts are auto-detected.

**Flat** — one JSON file per locale:

```
messages/
  en.json
  nl.json
```

**Namespaced** — subdirectory per locale, one JSON file per namespace (i18next-style):

```
messages/
  en/
    common.json
    auth.json
  nl/
    common.json
    auth.json
```

In namespace mode, prefix keys with the namespace: `common:Users.name`. Read operations (`query`, `list`, `search`, `missing`) work across all namespaces when no prefix is given. Write operations (`set`, `add`) require a namespace prefix.

## Tools

### `query`

Look up a translation key across all locale files. Returns the value for each locale that has the key.

| Parameter | Type   | Required | Description                              |
|-----------|--------|----------|------------------------------------------|
| `key`     | string | yes      | Dot-notation key, e.g. `"Users.name"` or `"common:Users.name"` |

### `set`

Set a translation value for a single locale. Creates intermediate keys if needed.

| Parameter | Type   | Required | Description                              |
|-----------|--------|----------|------------------------------------------|
| `locale`  | string | yes      | Locale code, e.g. `"nl"` or `"en"`      |
| `key`     | string | yes      | Dot-notation key, e.g. `"Users.name"` or `"common:Users.name"` |
| `value`   | string | yes      | The translation value                    |

### `add`

Add a translation key to multiple locales at once.

| Parameter      | Type                     | Required | Description                                              |
|----------------|--------------------------|----------|----------------------------------------------------------|
| `key`          | string                   | yes      | Dot-notation key, e.g. `"Users.name"` or `"common:Users.name"` |
| `translations` | `Record<string, string>` | yes      | Locale-to-value mapping, e.g. `{"nl": "Naam", "en": "Name"}` |

### `delete`

Delete a translation key from all locale files.

| Parameter | Type   | Required | Description                              |
|-----------|--------|----------|------------------------------------------|
| `key`     | string | yes      | Dot-notation key, e.g. `"Users.name"` or `"common:Users.name"` |

### `rename`

Rename a translation key across all locale files. Preserves values.

| Parameter | Type   | Required | Description                                    |
|-----------|--------|----------|------------------------------------------------|
| `oldKey`  | string | yes      | Current dot-notation key, e.g. `"Users.name"`  |
| `newKey`  | string | yes      | New dot-notation key, e.g. `"Users.fullName"`  |

### `move`

Move a translation key to a different path across all locale files.

| Parameter | Type   | Required | Description                                    |
|-----------|--------|----------|------------------------------------------------|
| `oldKey`  | string | yes      | Current dot-notation key, e.g. `"Users.name"`  |
| `newKey`  | string | yes      | New dot-notation key, e.g. `"Profile.name"`    |

### `list`

List all translation keys. Optionally filter by a key prefix.

| Parameter | Type   | Required | Description                                           |
|-----------|--------|----------|-------------------------------------------------------|
| `prefix`  | string | no       | Key prefix to filter by, e.g. `"Users"` or `"common:"` |

### `search`

Search translations by value (case-insensitive).

| Parameter | Type   | Required | Description                              |
|-----------|--------|----------|------------------------------------------|
| `value`   | string | yes      | Text to search for in translation values |

### `missing`

Find translation keys that exist in some locales but are missing in others. Takes no parameters.

## Development

```bash
pnpm install       # Install dependencies
pnpm dev           # Watch mode
pnpm test          # Run tests
pnpm test:watch    # Watch mode tests
pnpm build         # Compile TypeScript
```
