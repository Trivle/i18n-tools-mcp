import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { query, set, add } from './translations.js';

function createFixture(locales: Record<string, Record<string, unknown>>): string {
    const dir = mkdtempSync(join(tmpdir(), 'i18n-test-'));

    for (const [locale, data] of Object.entries(locales)) {
        writeFileSync(join(dir, `${locale}.json`), JSON.stringify(data, null, 4) + '\n');
    }

    return dir;
}

function readLocale(dir: string, locale: string): Record<string, unknown> {
    return JSON.parse(readFileSync(join(dir, `${locale}.json`), 'utf8'));
}

describe('query', () => {
    let dir: string;

    afterEach(() => {
        if (dir) {
            rmSync(dir, { recursive: true });
        }
    });

    it('returns values for a flat key across locales', () => {
        dir = createFixture({
            en: { Users: { name: 'Name' } },
            nl: { Users: { name: 'Naam' } },
        });

        const result = query('Users.name', dir);

        expect(result).toBe('en: Name\nnl: Naam');
    });

    it('returns nested object as JSON', () => {
        dir = createFixture({
            en: { Users: { labels: { first: 'First', last: 'Last' } } },
        });

        const result = query('Users.labels', dir);

        expect(result).toBe('en: {"first":"First","last":"Last"}');
    });

    it('returns not found message for missing key', () => {
        dir = createFixture({
            en: { Users: { name: 'Name' } },
        });

        const result = query('Users.nonexistent', dir);

        expect(result).toBe('Key "Users.nonexistent" not found in any locale.');
    });

    it('only returns locales that have the key', () => {
        dir = createFixture({
            en: { Users: { name: 'Name' } },
            nl: { Users: {} },
            de: { Users: { name: 'Name' } },
        });

        const result = query('Users.name', dir);

        expect(result).toBe('de: Name\nen: Name');
    });
});

describe('set', () => {
    let dir: string;

    afterEach(() => {
        if (dir) {
            rmSync(dir, { recursive: true });
        }
    });

    it('sets a value for an existing key', () => {
        dir = createFixture({
            nl: { Users: { name: 'Oude naam' } },
        });

        const result = set('nl', 'Users.name', 'Nieuwe naam', dir);

        expect(result).toBe('Set nl.Users.name = "Nieuwe naam"');
        expect(readLocale(dir, 'nl')).toEqual({ Users: { name: 'Nieuwe naam' } });
    });

    it('creates intermediate keys when needed', () => {
        dir = createFixture({
            nl: {},
        });

        set('nl', 'New.nested.key', 'Waarde', dir);

        expect(readLocale(dir, 'nl')).toEqual({ New: { nested: { key: 'Waarde' } } });
    });

    it('throws for unknown locale', () => {
        dir = createFixture({
            nl: {},
        });

        expect(() => set('fr', 'Key', 'Valeur', dir)).toThrow('Locale "fr" not found');
    });

    it('sanitizes curly quotes', () => {
        dir = createFixture({
            nl: {},
        });

        set('nl', 'Test.quote', '\u201CHallo\u201D', dir);

        expect(readLocale(dir, 'nl')).toEqual({ Test: { quote: '"Hallo"' } });
    });

    it('preserves other keys in the file', () => {
        dir = createFixture({
            nl: { Existing: { key: 'bestaand' }, Users: { name: 'Naam' } },
        });

        set('nl', 'Users.name', 'Nieuwe naam', dir);

        const data = readLocale(dir, 'nl');
        expect(data.Existing).toEqual({ key: 'bestaand' });
        expect(data.Users).toEqual({ name: 'Nieuwe naam' });
    });
});

describe('add', () => {
    let dir: string;

    afterEach(() => {
        if (dir) {
            rmSync(dir, { recursive: true });
        }
    });

    it('adds a key to multiple locales', () => {
        dir = createFixture({
            en: { Users: {} },
            nl: { Users: {} },
        });

        const result = add('Users.email', { nl: 'E-mail', en: 'Email' }, dir);

        expect(result).toBe('Added "Users.email" to 2 locale(s): nl, en');
        expect(readLocale(dir, 'nl')).toEqual({ Users: { email: 'E-mail' } });
        expect(readLocale(dir, 'en')).toEqual({ Users: { email: 'Email' } });
    });

    it('skips unknown locales with warning', () => {
        dir = createFixture({
            nl: {},
        });

        const result = add('Key', { nl: 'Waarde', xx: 'Unknown' }, dir);

        expect(result).toContain('Warning: locale "xx" not found');
        expect(result).toContain('Added "Key" to 1 locale(s): nl');
    });

    it('throws when no locales could be updated', () => {
        dir = createFixture({
            nl: {},
        });

        expect(() => add('Key', { xx: 'Unknown' }, dir)).toThrow('No locales were updated');
    });

    it('sanitizes curly quotes in all values', () => {
        dir = createFixture({
            en: {},
            nl: {},
        });

        add('Test.val', { nl: '\u2018test\u2019', en: '\u201Ctest\u201D' }, dir);

        expect(readLocale(dir, 'nl')).toEqual({ Test: { val: "'test'" } });
        expect(readLocale(dir, 'en')).toEqual({ Test: { val: '"test"' } });
    });
});
