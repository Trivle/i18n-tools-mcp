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

type JsonObject = Record<string, unknown>;

interface Entry {
    key: string;
    path: string[];
    value: unknown;
}

function isObject(value: unknown): value is JsonObject {
    return value != null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(obj: JsonObject, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(obj, key);
}

/**
 * Resolve a dot-notation key to the real chain of object keys. A single object key may itself
 * contain dots (Laravel-style flat files such as `{"auth.login.title": "..."}`), so at every
 * level the longest literal key wins, backtracking when a branch does not lead to the full key.
 */
function resolvePath(obj: JsonObject, key: string): string[] | undefined {
    return resolveParts(obj, key.split('.'));
}

function resolveParts(obj: JsonObject, parts: string[]): string[] | undefined {
    for (let i = parts.length; i > 0; i--) {
        const segment = parts.slice(0, i).join('.');

        if (!hasOwn(obj, segment)) {
            continue;
        }

        if (i === parts.length) {
            return [segment];
        }

        const child = obj[segment];
        if (isObject(child)) {
            const rest = resolveParts(child, parts.slice(i));
            if (rest) {
                return [segment, ...rest];
            }
        }
    }

    return undefined;
}

function parentOf(obj: JsonObject, path: string[]): JsonObject {
    let current = obj;

    for (const segment of path.slice(0, -1)) {
        current = current[segment] as JsonObject;
    }

    return current;
}

function collectEntries(obj: JsonObject, prefix: string = '', path: string[] = []): Entry[] {
    const entries: Entry[] = [];

    for (const [k, v] of Object.entries(obj)) {
        const key = prefix ? `${prefix}.${k}` : k;
        if (isObject(v)) {
            entries.push(...collectEntries(v, key, [...path, k]));
        } else {
            entries.push({ key, path: [...path, k], value: v });
        }
    }

    return entries;
}

function collectKeys(obj: JsonObject): string[] {
    return collectEntries(obj).map((entry) => entry.key);
}

/**
 * Leaf entries whose full key equals `key` or lives under it. Unlike resolvePath this also
 * finds groups that only exist as a shared prefix of flat keys (`datatable` for
 * `"datatable.columns"` and `"datatable.rows"`).
 */
function matchingEntries(obj: JsonObject, key: string): Entry[] {
    return collectEntries(obj).filter((entry) => entry.key === key || entry.key.startsWith(`${key}.`));
}

function getValue(obj: JsonObject, key: string): unknown {
    const path = resolvePath(obj, key);

    if (path) {
        return parentOf(obj, path)[path[path.length - 1]];
    }

    const entries = matchingEntries(obj, key);
    if (entries.length === 0) {
        return undefined;
    }

    return Object.fromEntries(entries.map((entry) => [entry.key.slice(key.length + 1), entry.value]));
}

function deleteValue(obj: JsonObject, key: string): boolean {
    let deleted = false;
    const path = resolvePath(obj, key);

    if (path) {
        delete parentOf(obj, path)[path[path.length - 1]];
        deleted = true;
    }

    for (const entry of matchingEntries(obj, key)) {
        delete parentOf(obj, entry.path)[entry.path[entry.path.length - 1]];
        deleted = true;
    }

    return deleted;
}

/**
 * Set a value, overwriting an existing key wherever it lives. A new key descends into existing
 * nested objects as far as possible; the remainder is written as one literal dotted key when
 * that object already uses dotted keys (flat style), and as nested objects otherwise.
 */
function setValue(obj: JsonObject, key: string, value: unknown): void {
    const path = resolvePath(obj, key);

    if (path) {
        parentOf(obj, path)[path[path.length - 1]] = value;
        return;
    }

    let current = obj;
    let parts = key.split('.');

    descend: while (parts.length > 1) {
        for (let i = parts.length - 1; i > 0; i--) {
            const segment = parts.slice(0, i).join('.');
            const child = current[segment];
            if (hasOwn(current, segment) && isObject(child)) {
                current = child;
                parts = parts.slice(i);
                continue descend;
            }
        }
        break;
    }

    if (Object.keys(current).some((k) => k.includes('.'))) {
        current[parts.join('.')] = value;
        return;
    }

    for (const part of parts.slice(0, -1)) {
        if (!isObject(current[part])) {
            current[part] = {};
        }
        current = current[part] as JsonObject;
    }

    current[parts[parts.length - 1]] = value;
}

function valueAt(obj: JsonObject, path: string[]): unknown {
    let current: unknown = obj;

    for (const segment of path) {
        if (!isObject(current) || !hasOwn(current, segment)) {
            return undefined;
        }
        current = current[segment];
    }

    return current;
}

/**
 * Move every leaf under `oldKey` to `newKey`. New keys are written before the old ones are
 * removed, so setValue still sees the file's key style (a flat file emptied first would look
 * nested). Afterwards the old node is dropped if it is an object that is now empty.
 */
function renameValue(obj: JsonObject, oldKey: string, newKey: string): boolean {
    const entries = matchingEntries(obj, oldKey);

    if (entries.length === 0) {
        return false;
    }

    const oldPath = resolvePath(obj, oldKey);
    const written = new Set<string>();

    for (const entry of entries) {
        const target = newKey + entry.key.slice(oldKey.length);
        setValue(obj, target, entry.value);
        written.add(JSON.stringify(resolvePath(obj, target)));
    }

    for (const entry of entries) {
        if (!written.has(JSON.stringify(entry.path)) && valueAt(obj, entry.path) !== undefined && !isObject(valueAt(obj, entry.path))) {
            delete parentOf(obj, entry.path)[entry.path[entry.path.length - 1]];
        }
    }

    if (oldPath) {
        const node = valueAt(obj, oldPath);
        if (isObject(node) && Object.keys(node).length === 0) {
            delete parentOf(obj, oldPath)[oldPath[oldPath.length - 1]];
        }
    }

    return true;
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
        const value = getValue(data, dotKey);

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
    setValue(data, dotKey, sanitize(value));
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
        if (deleteValue(data, dotKey)) {
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
        setValue(data, dotKey, sanitize(value));
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

        if (!renameValue(data, oldDotKey, newDotKey)) {
            continue;
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

        for (const { key, value: v } of collectEntries(data)) {
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

export type BatchOp =
    | { op: 'set'; locale: string; key: string; value: string }
    | { op: 'add'; key: string; translations: Record<string, string> }
    | { op: 'delete'; key: string }
    | { op: 'rename'; oldKey: string; newKey: string }
    | { op: 'move'; oldKey: string; newKey: string };

export function batch(ops: BatchOp[], dir?: string): string {
    const resolvedDir = dir || DEFAULT_DIR;
    const localeFiles = discoverLocaleFiles(resolvedDir);
    const cache = new Map<string, Record<string, unknown>>();
    const dirty = new Set<string>();

    const load = (file: LocaleFile): Record<string, unknown> => {
        if (!cache.has(file.path)) {
            cache.set(file.path, readJson(file.path));
        }
        return cache.get(file.path)!;
    };

    const summary: string[] = [];

    for (let i = 0; i < ops.length; i++) {
        const op = ops[i];

        try {
            switch (op.op) {
                case 'set': {
                    const { namespace, dotKey } = parseKey(op.key);
                    if (isNamespaced(localeFiles) && !namespace) {
                        throw new Error(`Namespace required in namespace mode. Use "namespace:${op.key}" format.`);
                    }
                    const file = findLocaleFile(localeFiles, op.locale, namespace);
                    if (!file) {
                        const target = namespace ? `${op.locale}/${namespace}` : op.locale;
                        throw new Error(`Locale "${target}" not found in ${resolvedDir}`);
                    }
                    setValue(load(file), dotKey, sanitize(op.value));
                    dirty.add(file.path);
                    summary.push(`set ${op.locale}.${op.key}`);
                    break;
                }

                case 'add': {
                    const { namespace, dotKey } = parseKey(op.key);
                    if (isNamespaced(localeFiles) && !namespace) {
                        throw new Error(`Namespace required in namespace mode. Use "namespace:${op.key}" format.`);
                    }
                    const updated: string[] = [];
                    const skipped: string[] = [];
                    for (const [locale, value] of Object.entries(op.translations)) {
                        const file = findLocaleFile(localeFiles, locale, namespace);
                        if (!file) {
                            skipped.push(locale);
                            continue;
                        }
                        setValue(load(file), dotKey, sanitize(value));
                        dirty.add(file.path);
                        updated.push(locale);
                    }
                    if (updated.length === 0) {
                        throw new Error(`No locales updated for "${op.key}"`);
                    }
                    const skipNote = skipped.length > 0 ? ` (skipped: ${skipped.join(', ')})` : '';
                    summary.push(`add ${op.key} → ${updated.join(', ')}${skipNote}`);
                    break;
                }

                case 'delete': {
                    const { namespace, dotKey } = parseKey(op.key);
                    const filesToSearch = filterFiles(localeFiles, namespace);
                    const deleted: string[] = [];
                    for (const file of filesToSearch) {
                        const data = load(file);
                        if (deleteValue(data, dotKey)) {
                            dirty.add(file.path);
                            deleted.push(file.locale);
                        }
                    }
                    summary.push(deleted.length > 0
                        ? `delete ${op.key} → ${deleted.join(', ')}`
                        : `delete ${op.key} → not found`);
                    break;
                }

                case 'rename':
                case 'move': {
                    const { namespace: oldNs, dotKey: oldDotKey } = parseKey(op.oldKey);
                    const { dotKey: newDotKey } = parseKey(op.newKey);
                    const filesToSearch = filterFiles(localeFiles, oldNs);
                    const renamed: string[] = [];
                    for (const file of filesToSearch) {
                        if (!renameValue(load(file), oldDotKey, newDotKey)) continue;

                        dirty.add(file.path);
                        renamed.push(file.locale);
                    }
                    summary.push(renamed.length > 0
                        ? `${op.op} ${op.oldKey} → ${op.newKey} (${renamed.join(', ')})`
                        : `${op.op} ${op.oldKey} → not found`);
                    break;
                }
            }
        } catch (error) {
            throw new Error(`Op #${i + 1} (${op.op}) failed: ${(error as Error).message}. No files written.`);
        }
    }

    for (const path of dirty) {
        writeJson(path, cache.get(path)!);
    }

    const header = `Batch: ${ops.length} op(s), ${dirty.size} file(s) written`;
    return [header, ...summary].join('\n');
}
