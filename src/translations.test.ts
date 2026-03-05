import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { query, set, add, remove, rename, missing, list, search, move } from './translations.js';

function createFixture(locales: Record<string, Record<string, unknown>>): string {
    const dir = mkdtempSync(join(tmpdir(), 'i18n-test-'));

    for (const [locale, data] of Object.entries(locales)) {
        writeFileSync(join(dir, `${locale}.json`), JSON.stringify(data, null, 4) + '\n');
    }

    return dir;
}

function createNamespacedFixture(locales: Record<string, Record<string, Record<string, unknown>>>): string {
    const dir = mkdtempSync(join(tmpdir(), 'i18n-test-'));

    for (const [locale, namespaces] of Object.entries(locales)) {
        const localeDir = join(dir, locale);
        mkdirSync(localeDir);

        for (const [ns, data] of Object.entries(namespaces)) {
            writeFileSync(join(localeDir, `${ns}.json`), JSON.stringify(data, null, 4) + '\n');
        }
    }

    return dir;
}

function readLocale(dir: string, locale: string): Record<string, unknown> {
    return JSON.parse(readFileSync(join(dir, `${locale}.json`), 'utf8'));
}

function readNamespacedLocale(dir: string, locale: string, ns: string): Record<string, unknown> {
    return JSON.parse(readFileSync(join(dir, locale, `${ns}.json`), 'utf8'));
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

describe('remove', () => {
    let dir: string;

    afterEach(() => {
        if (dir) {
            rmSync(dir, { recursive: true });
        }
    });

    it('deletes a key from all locales', () => {
        dir = createFixture({
            en: { Users: { name: 'Name', email: 'Email' } },
            nl: { Users: { name: 'Naam', email: 'E-mail' } },
        });

        const result = remove('Users.name', dir);

        expect(result).toBe('Deleted "Users.name" from 2 locale(s): en, nl');
        expect(readLocale(dir, 'en')).toEqual({ Users: { email: 'Email' } });
        expect(readLocale(dir, 'nl')).toEqual({ Users: { email: 'E-mail' } });
    });

    it('returns not found message for missing key', () => {
        dir = createFixture({
            en: { Users: { name: 'Name' } },
        });

        const result = remove('Users.nonexistent', dir);

        expect(result).toBe('Key "Users.nonexistent" not found in any locale.');
    });

    it('only deletes from locales that have the key', () => {
        dir = createFixture({
            en: { Users: { name: 'Name' } },
            nl: { Users: {} },
        });

        const result = remove('Users.name', dir);

        expect(result).toBe('Deleted "Users.name" from 1 locale(s): en');
    });

    it('deletes nested keys without affecting siblings', () => {
        dir = createFixture({
            en: { Users: { labels: { first: 'First', last: 'Last' } } },
        });

        remove('Users.labels.first', dir);

        expect(readLocale(dir, 'en')).toEqual({ Users: { labels: { last: 'Last' } } });
    });
});

describe('rename', () => {
    let dir: string;

    afterEach(() => {
        if (dir) {
            rmSync(dir, { recursive: true });
        }
    });

    it('renames a key across all locales', () => {
        dir = createFixture({
            en: { Users: { name: 'Name' } },
            nl: { Users: { name: 'Naam' } },
        });

        const result = rename('Users.name', 'Users.fullName', dir);

        expect(result).toBe('Renamed "Users.name" to "Users.fullName" in 2 locale(s): en, nl');
        expect(readLocale(dir, 'en')).toEqual({ Users: { fullName: 'Name' } });
        expect(readLocale(dir, 'nl')).toEqual({ Users: { fullName: 'Naam' } });
    });

    it('renames a nested object key', () => {
        dir = createFixture({
            en: { Users: { labels: { first: 'First', last: 'Last' } } },
        });

        rename('Users.labels', 'Profile.fields', dir);

        expect(readLocale(dir, 'en')).toEqual({ Users: {}, Profile: { fields: { first: 'First', last: 'Last' } } });
    });

    it('returns not found for missing key', () => {
        dir = createFixture({ en: {} });

        const result = rename('Nope', 'Also.nope', dir);

        expect(result).toBe('Key "Nope" not found in any locale.');
    });
});

describe('missing', () => {
    let dir: string;

    afterEach(() => {
        if (dir) {
            rmSync(dir, { recursive: true });
        }
    });

    it('finds keys missing in some locales', () => {
        dir = createFixture({
            en: { Users: { name: 'Name', email: 'Email' } },
            nl: { Users: { name: 'Naam' } },
        });

        const result = missing(dir);

        expect(result).toBe('nl: Users.email');
    });

    it('returns all ok when no keys are missing', () => {
        dir = createFixture({
            en: { Users: { name: 'Name' } },
            nl: { Users: { name: 'Naam' } },
        });

        const result = missing(dir);

        expect(result).toBe('All locales have all keys.');
    });
});

describe('list', () => {
    let dir: string;

    afterEach(() => {
        if (dir) {
            rmSync(dir, { recursive: true });
        }
    });

    it('lists all keys sorted', () => {
        dir = createFixture({
            en: { Users: { name: 'Name' }, Settings: { theme: 'dark' } },
        });

        const result = list(undefined, 1, 100, dir);

        expect(result).toBe('Page 1/1 (2 keys total)\nSettings.theme\nUsers.name');
    });

    it('filters by prefix', () => {
        dir = createFixture({
            en: { Users: { name: 'Name', email: 'Email' }, Settings: { theme: 'dark' } },
        });

        const result = list('Users', 1, 100, dir);

        expect(result).toBe('Page 1/1 (2 keys total)\nUsers.email\nUsers.name');
    });

    it('returns not found for non-matching prefix', () => {
        dir = createFixture({ en: { Users: { name: 'Name' } } });

        const result = list('Nope', 1, 100, dir);

        expect(result).toBe('No keys found with prefix "Nope".');
    });

    it('combines keys from all locales', () => {
        dir = createFixture({
            en: { Users: { name: 'Name' } },
            nl: { Users: { email: 'E-mail' } },
        });

        const result = list(undefined, 1, 100, dir);

        expect(result).toBe('Page 1/1 (2 keys total)\nUsers.email\nUsers.name');
    });

    it('paginates results', () => {
        dir = createFixture({
            en: { A: { a: '1', b: '2', c: '3' } },
        });

        const page1 = list(undefined, 1, 2, dir);
        const page2 = list(undefined, 2, 2, dir);

        expect(page1).toBe('Page 1/2 (3 keys total)\nA.a\nA.b');
        expect(page2).toBe('Page 2/2 (3 keys total)\nA.c');
    });
});

describe('search', () => {
    let dir: string;

    afterEach(() => {
        if (dir) {
            rmSync(dir, { recursive: true });
        }
    });

    it('finds translations containing the search term', () => {
        dir = createFixture({
            en: { Users: { name: 'Full Name', email: 'Email' } },
            nl: { Users: { name: 'Volledige naam', email: 'E-mail' } },
        });

        const result = search('Full', 1, 100, dir);

        expect(result).toBe('Page 1/1 (1 results total)\nen.Users.name = "Full Name"');
    });

    it('is case-insensitive', () => {
        dir = createFixture({
            en: { Test: { val: 'Hello World' } },
        });

        const result = search('hello', 1, 100, dir);

        expect(result).toBe('Page 1/1 (1 results total)\nen.Test.val = "Hello World"');
    });

    it('returns not found for no matches', () => {
        dir = createFixture({
            en: { Users: { name: 'Name' } },
        });

        const result = search('zzz', 1, 100, dir);

        expect(result).toBe('No translations found containing "zzz".');
    });
});

describe('move', () => {
    let dir: string;

    afterEach(() => {
        if (dir) {
            rmSync(dir, { recursive: true });
        }
    });

    it('moves a key to a different path', () => {
        dir = createFixture({
            en: { Users: { name: 'Name' } },
            nl: { Users: { name: 'Naam' } },
        });

        const result = move('Users.name', 'Profile.name', dir);

        expect(result).toBe('Moved "Users.name" to "Profile.name" in 2 locale(s): en, nl');
        expect(readLocale(dir, 'en')).toEqual({ Users: {}, Profile: { name: 'Name' } });
        expect(readLocale(dir, 'nl')).toEqual({ Users: {}, Profile: { name: 'Naam' } });
    });
});

describe('namespace mode', () => {
    let dir: string;

    afterEach(() => {
        if (dir) {
            rmSync(dir, { recursive: true });
        }
    });

    it('query with namespace prefix', () => {
        dir = createNamespacedFixture({
            en: { common: { Users: { name: 'Name' } }, auth: { login: { title: 'Login' } } },
            nl: { common: { Users: { name: 'Naam' } }, auth: { login: { title: 'Inloggen' } } },
        });

        const result = query('common:Users.name', dir);

        expect(result).toBe('en: Name\nnl: Naam');
    });

    it('query without namespace searches all namespaces', () => {
        dir = createNamespacedFixture({
            en: { common: { Users: { name: 'Name' } }, auth: { login: { title: 'Login' } } },
        });

        const result = query('Users.name', dir);

        expect(result).toBe('en (common): Name');
    });

    it('set requires namespace prefix', () => {
        dir = createNamespacedFixture({
            nl: { common: { Users: { name: 'Naam' } } },
        });

        expect(() => set('nl', 'Users.name', 'Nieuwe naam', dir)).toThrow('Namespace required');
    });

    it('set with namespace prefix', () => {
        dir = createNamespacedFixture({
            nl: { common: { Users: { name: 'Naam' } } },
        });

        set('nl', 'common:Users.name', 'Nieuwe naam', dir);

        expect(readNamespacedLocale(dir, 'nl', 'common')).toEqual({ Users: { name: 'Nieuwe naam' } });
    });

    it('add with namespace prefix', () => {
        dir = createNamespacedFixture({
            en: { common: {} },
            nl: { common: {} },
        });

        const result = add('common:Users.email', { nl: 'E-mail', en: 'Email' }, dir);

        expect(result).toBe('Added "common:Users.email" to 2 locale(s): nl, en');
        expect(readNamespacedLocale(dir, 'nl', 'common')).toEqual({ Users: { email: 'E-mail' } });
    });

    it('remove with namespace prefix', () => {
        dir = createNamespacedFixture({
            en: { common: { Users: { name: 'Name', email: 'Email' } } },
            nl: { common: { Users: { name: 'Naam', email: 'E-mail' } } },
        });

        const result = remove('common:Users.name', dir);

        expect(result).toBe('Deleted "common:Users.name" from 2 locale(s): en, nl');
        expect(readNamespacedLocale(dir, 'en', 'common')).toEqual({ Users: { email: 'Email' } });
    });

    it('remove without namespace deletes from all namespaces', () => {
        dir = createNamespacedFixture({
            en: { common: { shared: { title: 'Title' } }, auth: { shared: { title: 'Auth Title' } } },
        });

        const result = remove('shared.title', dir);

        expect(result).toBe('Deleted "shared.title" from 2 locale(s): en (auth), en (common)');
    });

    it('list includes namespace prefix', () => {
        dir = createNamespacedFixture({
            en: { common: { Users: { name: 'Name' } }, auth: { login: { title: 'Login' } } },
        });

        const result = list(undefined, 1, 100, dir);

        expect(result).toBe('Page 1/1 (2 keys total)\nauth:login.title\ncommon:Users.name');
    });

    it('list filters by namespace prefix', () => {
        dir = createNamespacedFixture({
            en: { common: { Users: { name: 'Name' } }, auth: { login: { title: 'Login' } } },
        });

        const result = list('common:', 1, 100, dir);

        expect(result).toBe('Page 1/1 (1 keys total)\ncommon:Users.name');
    });

    it('missing detects keys missing across namespaces', () => {
        dir = createNamespacedFixture({
            en: { common: { Users: { name: 'Name', email: 'Email' } } },
            nl: { common: { Users: { name: 'Naam' } } },
        });

        const result = missing(dir);

        expect(result).toBe('nl: common:Users.email');
    });

    it('search includes namespace in output', () => {
        dir = createNamespacedFixture({
            en: { common: { Users: { name: 'Full Name' } } },
        });

        const result = search('Full', 1, 100, dir);

        expect(result).toBe('Page 1/1 (1 results total)\nen.common:Users.name = "Full Name"');
    });

    it('rename with namespace prefix', () => {
        dir = createNamespacedFixture({
            en: { common: { Users: { name: 'Name' } } },
            nl: { common: { Users: { name: 'Naam' } } },
        });

        const result = rename('common:Users.name', 'common:Users.fullName', dir);

        expect(result).toBe('Renamed "common:Users.name" to "common:Users.fullName" in 2 locale(s): en, nl');
        expect(readNamespacedLocale(dir, 'en', 'common')).toEqual({ Users: { fullName: 'Name' } });
    });
});
