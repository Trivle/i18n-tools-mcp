import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';

const DEFAULT_DIR = 'messages';

interface LocaleFile {
    locale: string;
    path: string;
}

function sanitize(value: string): string {
    return value
        .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
        .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'");
}

function discoverLocaleFiles(dir: string): LocaleFile[] {
    const resolvedDir = resolve(dir);
    const files = readdirSync(resolvedDir).filter((f) => f.endsWith('.json')).sort();

    return files.map((f) => ({
        locale: basename(f, '.json'),
        path: join(resolvedDir, f),
    }));
}

function readJson(filePath: string): Record<string, unknown> {
    const raw = readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as Record<string, unknown>;
}

function writeJson(filePath: string, data: Record<string, unknown>): void {
    const json = JSON.stringify(data, null, 4) + '\n';
    writeFileSync(filePath, json, 'utf8');
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

export function query(key: string, dir?: string): string {
    const resolvedDir = dir || DEFAULT_DIR;
    const localeFiles = discoverLocaleFiles(resolvedDir);
    const results: string[] = [];

    for (const { locale, path } of localeFiles) {
        const data = readJson(path);
        const value = getNestedValue(data, key);

        if (value !== undefined) {
            if (typeof value === 'object') {
                results.push(`${locale}: ${JSON.stringify(value)}`);
            } else {
                results.push(`${locale}: ${value}`);
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
    const localeFile = localeFiles.find((f) => f.locale === locale);

    if (!localeFile) {
        throw new Error(`Locale "${locale}" not found in ${resolvedDir}`);
    }

    const data = readJson(localeFile.path);
    setNestedValue(data, key, sanitize(value));
    writeJson(localeFile.path, data);

    return `Set ${locale}.${key} = "${value}"`;
}

export function add(key: string, translations: Record<string, string>, dir?: string): string {
    const resolvedDir = dir || DEFAULT_DIR;
    const localeFiles = discoverLocaleFiles(resolvedDir);
    const localeMap = new Map(localeFiles.map((f) => [f.locale, f]));
    const updated: string[] = [];
    const warnings: string[] = [];

    for (const [locale, value] of Object.entries(translations)) {
        const localeFile = localeMap.get(locale);
        if (!localeFile) {
            warnings.push(`Warning: locale "${locale}" not found in ${resolvedDir}, skipping`);
            continue;
        }

        const data = readJson(localeFile.path);
        setNestedValue(data, key, sanitize(value));
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
