# @trivle/i18n-tools-mcp

MCP server for querying and managing JSON translation files. Designed for AI agents (Claude Code, Cursor, etc.) to read and write translations directly through the Model Context Protocol.

## Tools

### `query`

Look up a translation key across all locale files.

| Parameter | Type   | Required | Description                              |
|-----------|--------|----------|------------------------------------------|
| `key`     | string | yes      | Dot-notation key, e.g. `"Users.name"`    |

Returns the value for each locale that has the key.

### `set`

Set a translation value for a single locale. Creates intermediate keys if needed.

| Parameter | Type   | Required | Description                              |
|-----------|--------|----------|------------------------------------------|
| `locale`  | string | yes      | Locale code, e.g. `"nl"` or `"en"`      |
| `key`     | string | yes      | Dot-notation key, e.g. `"Users.name"`    |
| `value`   | string | yes      | The translation value                    |

### `add`

Add a translation key to multiple locales at once.

| Parameter      | Type                     | Required | Description                                              |
|----------------|--------------------------|----------|----------------------------------------------------------|
| `key`          | string                   | yes      | Dot-notation key, e.g. `"Users.name"`                    |
| `translations` | `Record<string, string>` | yes      | Locale-to-value mapping, e.g. `{"nl": "Naam", "en": "Name"}` |

## Setup

```bash
git clone git@github.com:Trivle/i18n-tools-mcp.git
cd i18n-tools-mcp
pnpm install
pnpm build
```

## Configuration

Add to your MCP client config (e.g. `.claude/settings.json`):

```json
{
  "mcpServers": {
    "i18n-tools": {
      "command": "node",
      "args": [
        "/path/to/i18n-tools-mcp/dist/index.js",
        "/path/to/your/messages",
        "nl"
      ]
    }
  }
}
```

Arguments:

1. Path to the compiled server (`dist/index.js`)
2. **Required**: Absolute path to the directory containing your `{locale}.json` files
3. **Optional**: Base locale code (default: `nl`) — used in tool descriptions to guide AI agents

## Development

```bash
pnpm dev          # Watch mode
pnpm test         # Run tests
pnpm test:watch   # Watch mode
pnpm build        # Compile TypeScript
```
