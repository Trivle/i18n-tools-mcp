import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';

const DEFAULT_DIR = 'messages';
const NS_SEPARATOR = ':';

let jsonIndent: number = 4;

interface LocaleFile {
    locale: string;
    namespace?: string;
    path: string;
}

function sanitize(value: string): string {
    return value
        .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
        .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'");
}

function discoverLocaleFiles(dir: string): LocaleFile[] {
    const resolvedDir = resolve(dir);
    const entries = readdirSync(resolvedDir, { withFileTypes: true });
    const subdirs = entries.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));

    if (subdirs.length > 0) {
        const files: LocaleFile[] = [];

        for (const subdir of subdirs) {
            const localePath = join(resolvedDir, subdir.name);
            const jsonFiles = readdirSync(localePath).filter((f) => f.endsWith('.json')).sort();

            for (const f of jsonFiles) {
                files.push({
                    locale: subdir.name,
                    namespace: basename(f, '.json'),
                    path: join(localePath, f),
                });
            }
        }

        return files;
    }

    const jsonFiles = entries
        .filter((e) => e.isFile() && e.name.endsWith('.json'))
        .sort((a, b) => a.name.localeCompare(b.name));

    return jsonFiles.map((f) => ({
        locale: basename(f.name, '.json'),
        path: join(resolvedDir, f.name),
    }));
}

function parseKey(key: string): { namespace?: string; dotKey: string } {
    const colonIndex = key.indexOf(NS_SEPARATOR);

    if (colonIndex > 0) {
        return { namespace: key.substring(0, colonIndex), dotKey: key.substring(colonIndex + 1) };
    }

    return { dotKey: key };
}

function isNamespaced(files: LocaleFile[]): boolean {
    return files.some((f) => f.namespace !== undefined);
}

function fullKey(file: LocaleFile, dotKey: string): string {
    if (file.namespace) {
        return `${file.namespace}${NS_SEPARATOR}${dotKey}`;
    }

    return dotKey;
}

function readJson(filePath: string): Record<string, unknown> {
    const raw = readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as Record<string, unknown>;
}

function writeJson(filePath: string, data: Record<string, unknown>): void {
    const json = JSON.stringify(data, null, jsonIndent) + '\n';
    writeFileSync(filePath, json, 'utf8');
}

export function setIndent(spaces: number): void {
    jsonIndent = spaces;
}

function getNestedValue(obj: Record<string, unknown>, key: string): unknown {
    const parts = key.split('.');
    let current: unknown = obj;

    for (const part of parts) {
        if (current == null || typeof current !== 'object') {
            return undefined;
        }
        current = (current as Record<string, unknown>)[part];
    }

    return current;
}

function deleteNestedValue(obj: Record<string, unknown>, key: string): boolean {
    const parts = key.split('.');
    let current: Record<string, unknown> = obj;

    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (current[part] == null || typeof current[part] !== 'object') {
            return false;
        }
        current = current[part] as Record<string, unknown>;
    }

    const lastPart = parts[parts.length - 1];
    if (!(lastPart in current)) {
        return false;
    }

    delete current[lastPart];
    return true;
}

function setNestedValue(obj: Record<string, unknown>, key: string, value: string): void {
    const parts = key.split('.');
    let current: Record<string, unknown> = obj;

    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (current[part] == null || typeof current[part] !== 'object') {
            current[part] = {};
        }
        current = current[part] as Record<string, unknown>;
    }

    current[parts[parts.length - 1]] = value;
}

function collectKeys(obj: Record<string, unknown>, prefix: string = ''): string[] {
    const keys: string[] = [];

    for (const [k, v] of Object.entries(obj)) {
        const fk = prefix ? `${prefix}.${k}` : k;
        if (v != null && typeof v === 'object' && !Array.isArray(v)) {
            keys.push(...collectKeys(v as Record<string, unknown>, fk));
        } else {
            keys.push(fk);
        }
    }

    return keys;
}

function filterFiles(files: LocaleFile[], namespace?: string): LocaleFile[] {
    if (!namespace) {
        return files;
    }

    return files.filter((f) => f.namespace === namespace);
}

function findLocaleFile(files: LocaleFile[], locale: string, namespace?: string): LocaleFile | undefined {
    if (namespace) {
        return files.find((f) => f.locale === locale && f.namespace === namespace);
    }

    return files.find((f) => f.locale === locale);
}

export function query(key: string, dir?: string): string {
    const resolvedDir = dir || DEFAULT_DIR;
    const localeFiles = discoverLocaleFiles(resolvedDir);
    const { namespace, dotKey } = parseKey(key);
    const filesToSearch = filterFiles(localeFiles, namespace);
    const results: string[] = [];

    for (const file of filesToSearch) {
        const data = readJson(file.path);
        const value = getNestedValue(data, dotKey);

        if (value !== undefined) {
            const label = !namespace && file.namespace
                ? `${file.locale} (${file.namespace})`
                : file.locale;

            if (typeof value === 'object') {
                results.push(`${label}: ${JSON.stringify(value)}`);
            } else {
                results.push(`${label}: ${value}`);
            }
        }
    }

    if (results.length === 0) {
        return `Key "${key}" not found in any locale.`;
    }

    return results.join('\n');
}

export function set(locale: string, key: string, value: string, dir?: string): string {
    const resolvedDir = dir || DEFAULT_DIR;
    const localeFiles = discoverLocaleFiles(resolvedDir);
    const { namespace, dotKey } = parseKey(key);

    if (isNamespaced(localeFiles) && !namespace) {
        throw new Error(`Namespace required in namespace mode. Use "namespace:${key}" format.`);
    }

    const localeFile = findLocaleFile(localeFiles, locale, namespace);

    if (!localeFile) {
        const target = namespace ? `${locale}/${namespace}` : locale;
        throw new Error(`Locale "${target}" not found in ${resolvedDir}`);
    }

    const data = readJson(localeFile.path);
    setNestedValue(data, dotKey, sanitize(value));
    writeJson(localeFile.path, data);

    return `Set ${locale}.${key} = "${value}"`;
}

export function remove(key: string, dir?: string): string {
    const resolvedDir = dir || DEFAULT_DIR;
    const localeFiles = discoverLocaleFiles(resolvedDir);
    const { namespace, dotKey } = parseKey(key);
    const filesToSearch = filterFiles(localeFiles, namespace);
    const deleted: string[] = [];

    for (const file of filesToSearch) {
        const data = readJson(file.path);
        if (deleteNestedValue(data, dotKey)) {
            writeJson(file.path, data);
            const label = !namespace && file.namespace
                ? `${file.locale} (${file.namespace})`
                : file.locale;
            deleted.push(label);
        }
    }

    if (deleted.length === 0) {
        return `Key "${key}" not found in any locale.`;
    }

    return `Deleted "${key}" from ${deleted.length} locale(s): ${deleted.join(', ')}`;
}

export function add(key: string, translations: Record<string, string>, dir?: string): string {
    const resolvedDir = dir || DEFAULT_DIR;
    const localeFiles = discoverLocaleFiles(resolvedDir);
    const { namespace, dotKey } = parseKey(key);

    if (isNamespaced(localeFiles) && !namespace) {
        throw new Error(`Namespace required in namespace mode. Use "namespace:${key}" format.`);
    }

    const updated: string[] = [];
    const warnings: string[] = [];

    for (const [locale, value] of Object.entries(translations)) {
        const localeFile = findLocaleFile(localeFiles, locale, namespace);

        if (!localeFile) {
            const target = namespace ? `${locale}/${namespace}` : locale;
            warnings.push(`Warning: locale "${target}" not found in ${resolvedDir}, skipping`);
            continue;
        }

        const data = readJson(localeFile.path);
        setNestedValue(data, dotKey, sanitize(value));
        writeJson(localeFile.path, data);
        updated.push(locale);
    }

    if (updated.length === 0) {
        throw new Error('No locales were updated');
    }

    const lines: string[] = [];
    if (warnings.length > 0) {
        lines.push(...warnings);
    }
    lines.push(`Added "${key}" to ${updated.length} locale(s): ${updated.join(', ')}`);

    return lines.join('\n');
}

export function rename(oldKey: string, newKey: string, dir?: string): string {
    const resolvedDir = dir || DEFAULT_DIR;
    const localeFiles = discoverLocaleFiles(resolvedDir);
    const { namespace: oldNs, dotKey: oldDotKey } = parseKey(oldKey);
    const { dotKey: newDotKey } = parseKey(newKey);
    const filesToSearch = filterFiles(localeFiles, oldNs);
    const renamed: string[] = [];

    for (const file of filesToSearch) {
        const data = readJson(file.path);
        const value = getNestedValue(data, oldDotKey);

        if (value === undefined) {
            continue;
        }

        deleteNestedValue(data, oldDotKey);

        if (typeof value === 'object' && value !== null) {
            const subKeys = collectKeys(value as Record<string, unknown>);
            for (const subKey of subKeys) {
                const subValue = getNestedValue(value as Record<string, unknown>, subKey);
                setNestedValue(data, `${newDotKey}.${subKey}`, subValue as string);
            }
        } else {
            setNestedValue(data, newDotKey, value as string);
        }

        writeJson(file.path, data);
        const label = !oldNs && file.namespace
            ? `${file.locale} (${file.namespace})`
            : file.locale;
        renamed.push(label);
    }

    if (renamed.length === 0) {
        return `Key "${oldKey}" not found in any locale.`;
    }

    return `Renamed "${oldKey}" to "${newKey}" in ${renamed.length} locale(s): ${renamed.join(', ')}`;
}

export function missing(dir?: string): string {
    const resolvedDir = dir || DEFAULT_DIR;
    const localeFiles = discoverLocaleFiles(resolvedDir);
    const allKeys = new Set<string>();
    const localeKeys = new Map<string, Set<string>>();

    for (const file of localeFiles) {
        const data = readJson(file.path);
        const keys = collectKeys(data).map((k) => fullKey(file, k));

        if (!localeKeys.has(file.locale)) {
            localeKeys.set(file.locale, new Set());
        }

        const existing = localeKeys.get(file.locale)!;
        keys.forEach((k) => {
            allKeys.add(k);
            existing.add(k);
        });
    }

    const results: string[] = [];

    for (const [locale, keys] of localeKeys) {
        const missingKeys = [...allKeys].filter((k) => !keys.has(k)).sort();
        if (missingKeys.length > 0) {
            results.push(`${locale}: ${missingKeys.join(', ')}`);
        }
    }

    if (results.length === 0) {
        return 'All locales have all keys.';
    }

    return results.join('\n');
}

export function list(prefix?: string, page: number = 1, pageSize: number = 100, dir?: string): string {
    const resolvedDir = dir || DEFAULT_DIR;
    const localeFiles = discoverLocaleFiles(resolvedDir);
    const allKeys = new Set<string>();

    for (const file of localeFiles) {
        const data = readJson(file.path);
        collectKeys(data).forEach((k) => allKeys.add(fullKey(file, k)));
    }

    let keys = [...allKeys].sort();

    if (prefix) {
        keys = keys.filter((k) => k.startsWith(prefix));
    }

    if (keys.length === 0) {
        return prefix ? `No keys found with prefix "${prefix}".` : 'No keys found.';
    }

    const totalPages = Math.ceil(keys.length / pageSize);
    const start = (page - 1) * pageSize;
    const pageKeys = keys.slice(start, start + pageSize);

    if (pageKeys.length === 0) {
        return `Page ${page} is out of range. Total pages: ${totalPages}`;
    }

    const header = `Page ${page}/${totalPages} (${keys.length} keys total)`;

    return `${header}\n${pageKeys.join('\n')}`;
}

export function search(value: string, page: number = 1, pageSize: number = 100, dir?: string): string {
    const resolvedDir = dir || DEFAULT_DIR;
    const localeFiles = discoverLocaleFiles(resolvedDir);
    const results: string[] = [];
    const lowerValue = value.toLowerCase();

    for (const file of localeFiles) {
        const data = readJson(file.path);
        const keys = collectKeys(data);

        for (const key of keys) {
            const v = getNestedValue(data, key);
            if (typeof v === 'string' && v.toLowerCase().includes(lowerValue)) {
                const fk = fullKey(file, key);
                results.push(`${file.locale}.${fk} = "${v}"`);
            }
        }
    }

    if (results.length === 0) {
        return `No translations found containing "${value}".`;
    }

    const totalPages = Math.ceil(results.length / pageSize);
    const start = (page - 1) * pageSize;
    const pageResults = results.slice(start, start + pageSize);

    if (pageResults.length === 0) {
        return `Page ${page} is out of range. Total pages: ${totalPages}`;
    }

    const header = `Page ${page}/${totalPages} (${results.length} results total)`;

    return `${header}\n${pageResults.join('\n')}`;
}

export function move(oldKey: string, newKey: string, dir?: string): string {
    return rename(oldKey, newKey, dir).replace('Renamed', 'Moved');
}
