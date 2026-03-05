#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { query, set, add, remove, rename, missing, list, search, move, setIndent } from './translations.js';

const baseDir = process.argv[2];
if (!baseDir) {
    console.error('Usage: i18n-tools-mcp <translations-directory> [base-locale] [indent]');
    process.exit(1);
}

const baseLocale = process.argv[3] || 'nl';
const indent = parseInt(process.argv[4] || '4', 10);
setIndent(indent);

const server = new McpServer({
    name: 'i18n-tools',
    version: '0.1.0',
});

server.registerTool(
    'query',
    {
        description: 'Look up a translation key across all locale files. Returns the value for each locale that has the key.',
        inputSchema: {
            key: z.string().describe('Dot-notation translation key, e.g. "Users.name"'),
        },
    },
    async ({ key }) => {
        try {
            const result = query(key, baseDir);
            return { content: [{ type: 'text', text: result }] };
        } catch (error) {
            return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
        }
    },
);

server.registerTool(
    'set',
    {
        description: 'Set a translation value for a single locale. Creates intermediate keys if needed.',
        inputSchema: {
            locale: z.string().describe(`Locale code, e.g. "${baseLocale}" or "en"`),
            key: z.string().describe('Dot-notation translation key, e.g. "Users.name"'),
            value: z.string().describe('The translation value to set'),
        },
    },
    async ({ locale, key, value }) => {
        try {
            const result = set(locale, key, value, baseDir);
            return { content: [{ type: 'text', text: result }] };
        } catch (error) {
            return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
        }
    },
);

server.registerTool(
    'add',
    {
        description: `Add a translation key to multiple locales at once. Always include at least the base locale "${baseLocale}". Other locales are optional and will be filled by the AI translation pipeline.`,
        inputSchema: {
            key: z.string().describe('Dot-notation translation key, e.g. "Users.name"'),
            translations: z.record(z.string(), z.string()).describe(`Object mapping locale codes to translation values. Always include "${baseLocale}" as the base locale. Example: {"${baseLocale}": "Naam", "en": "Name"}`),
        },
    },
    async ({ key, translations }) => {
        try {
            const result = add(key, translations, baseDir);
            return { content: [{ type: 'text', text: result }] };
        } catch (error) {
            return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
        }
    },
);

server.registerTool(
    'delete',
    {
        description: 'Delete a translation key from all locale files.',
        inputSchema: {
            key: z.string().describe('Dot-notation translation key, e.g. "Users.name"'),
        },
    },
    async ({ key }) => {
        try {
            const result = remove(key, baseDir);
            return { content: [{ type: 'text', text: result }] };
        } catch (error) {
            return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
        }
    },
);

server.registerTool(
    'rename',
    {
        description: 'Rename a translation key across all locale files. Preserves values.',
        inputSchema: {
            oldKey: z.string().describe('Current dot-notation key, e.g. "Users.name"'),
            newKey: z.string().describe('New dot-notation key, e.g. "Users.fullName"'),
        },
    },
    async ({ oldKey, newKey }) => {
        try {
            const result = rename(oldKey, newKey, baseDir);
            return { content: [{ type: 'text', text: result }] };
        } catch (error) {
            return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
        }
    },
);

server.registerTool(
    'missing',
    {
        description: 'Find translation keys that exist in some locales but are missing in others.',
        inputSchema: {},
    },
    async () => {
        try {
            const result = missing(baseDir);
            return { content: [{ type: 'text', text: result }] };
        } catch (error) {
            return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
        }
    },
);

server.registerTool(
    'list',
    {
        description: 'List all translation keys. Optionally filter by a key prefix. Results are paginated (100 keys per page).',
        inputSchema: {
            prefix: z.string().optional().describe('Key prefix to filter by, e.g. "Users" to list all keys under Users'),
            page: z.number().optional().describe('Page number (default: 1)'),
            pageSize: z.number().optional().describe('Number of keys per page (default: 100)'),
        },
    },
    async ({ prefix, page, pageSize }) => {
        try {
            const result = list(prefix, page ?? 1, pageSize ?? 100, baseDir);
            return { content: [{ type: 'text', text: result }] };
        } catch (error) {
            return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
        }
    },
);

server.registerTool(
    'search',
    {
        description: 'Search translations by value. Finds all keys where the translation contains the search term (case-insensitive). Results are paginated (100 results per page).',
        inputSchema: {
            value: z.string().describe('Text to search for in translation values'),
            page: z.number().optional().describe('Page number (default: 1)'),
            pageSize: z.number().optional().describe('Number of results per page (default: 100)'),
        },
    },
    async ({ value, page, pageSize }) => {
        try {
            const result = search(value, page ?? 1, pageSize ?? 100, baseDir);
            return { content: [{ type: 'text', text: result }] };
        } catch (error) {
            return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
        }
    },
);

server.registerTool(
    'move',
    {
        description: 'Move a translation key to a different path across all locale files. Same as rename.',
        inputSchema: {
            oldKey: z.string().describe('Current dot-notation key, e.g. "Users.name"'),
            newKey: z.string().describe('New dot-notation key, e.g. "Profile.name"'),
        },
    },
    async ({ oldKey, newKey }) => {
        try {
            const result = move(oldKey, newKey, baseDir);
            return { content: [{ type: 'text', text: result }] };
        } catch (error) {
            return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }], isError: true };
        }
    },
);

async function main(): Promise<void> {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
