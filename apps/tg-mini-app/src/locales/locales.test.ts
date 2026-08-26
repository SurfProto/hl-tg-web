import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Guards on the translation files themselves, rather than on any screen.
 *
 * `positions.markPrice` was declared twice in en.json. JSON keeps the last
 * declaration and drops the first silently, so the label the positions card
 * asked for resolved to a copy of the protection sheet's `Mark {{price}}` and
 * the card rendered the literal `MARK {{PRICE}}` — with nothing failing. The
 * same stray key existed in ru.json, where it had replaced the label outright.
 *
 * Nothing else catches this: the app never enumerates its own keys, and both
 * files parse. These three checks do, and they are cheap.
 */

const LOCALES_DIR = dirname(fileURLToPath(import.meta.url));
const LOCALE_FILES = ["en.json", "ru.json"] as const;

function readLocale(file: string): string {
  return readFileSync(resolve(LOCALES_DIR, file), "utf8");
}

/**
 * Every duplicated key path in a prettier-formatted locale file.
 *
 * JSON.parse cannot answer this — by the time it returns, the duplicate is
 * gone. So this walks the raw text instead. It relies on the formatting these
 * files already have: a key that opens an object is alone on its line and ends
 * with `{`, and a closing brace is alone on its line. A value containing
 * braces, like `Mark {{price}}`, stays inside quotes on a line that ends in a
 * comma, so it never reads as an object.
 */
function findDuplicateKeys(source: string): string[] {
  const stack: string[] = [];
  const seen = new Map<string, number>();
  const duplicates: string[] = [];

  for (const rawLine of source.split("\n")) {
    const line = rawLine.trim();

    if (/^\},?$/.test(line)) {
      stack.pop();
      continue;
    }

    const opening = line.match(/^"([^"]+)":\s*\{$/);
    if (opening) {
      const path = [...stack, opening[1]!].join(".");
      const count = (seen.get(path) ?? 0) + 1;
      seen.set(path, count);
      if (count === 2) duplicates.push(path);
      stack.push(opening[1]!);
      continue;
    }

    const entry = line.match(/^"([^"]+)":/);
    if (entry) {
      const path = [...stack, entry[1]!].join(".");
      const count = (seen.get(path) ?? 0) + 1;
      seen.set(path, count);
      if (count === 2) duplicates.push(path);
    }
  }

  return duplicates;
}

function flatten(value: unknown, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  if (value === null || typeof value !== "object") return out;

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child !== null && typeof child === "object" && !Array.isArray(child)) {
      for (const [k, v] of flatten(child, path)) out.set(k, v);
    } else if (typeof child === "string") {
      out.set(path, child);
    }
  }
  return out;
}

/** The `{{name}}` placeholders a string expects, in sorted order. */
function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]!).sort();
}

/**
 * A key with its i18next plural suffix removed.
 *
 * Plural categories are a property of the language, not of the message:
 * English needs `_one`/`_other` where Russian also needs `_few`/`_many`.
 * Comparing raw keys across locales would therefore report a correct Russian
 * translation as a mismatch, so the comparison is made on the base key and the
 * suffixes are deliberately not required to line up.
 */
function pluralBaseKey(key: string): string {
  return key.replace(/_(zero|one|two|few|many|other)$/, "");
}

describe("locale files", () => {
  it.each(LOCALE_FILES)("declares every key once in %s", (file) => {
    expect(findDuplicateKeys(readLocale(file))).toEqual([]);
  });

  it("translates the same set of keys in every locale", () => {
    const [reference, ...rest] = LOCALE_FILES.map((file) => ({
      file,
      keys: [
        ...new Set(
          [...flatten(JSON.parse(readLocale(file))).keys()].map(pluralBaseKey),
        ),
      ].sort(),
    }));

    for (const locale of rest) {
      expect(
        locale.keys,
        `${locale.file} does not match ${reference!.file}`,
      ).toEqual(reference!.keys);
    }
  });

  it.each(LOCALE_FILES)(
    "gives the positions card a label, not a template, in %s",
    (file) => {
      // The regression itself. PositionsPage renders this key with no
      // interpolation values, so a translation carrying `{{price}}` reaches
      // the screen with the braces intact. Parity between locales cannot catch
      // it, because both locales were wrong in the same way.
      const strings = flatten(JSON.parse(readLocale(file)));

      expect(placeholders(strings.get("positions.markPrice") ?? "")).toEqual(
        [],
      );
    },
  );

  it("expects the same interpolation values in every locale", () => {
    const [reference, ...rest] = LOCALE_FILES.map((file) => ({
      file,
      strings: flatten(JSON.parse(readLocale(file))),
    }));

    for (const locale of rest) {
      for (const [key, value] of locale.strings) {
        const expected = reference!.strings.get(key);
        if (expected === undefined) continue;
        expect(
          placeholders(value),
          `${key} in ${locale.file} interpolates different values than ${reference!.file}`,
        ).toEqual(placeholders(expected));
      }
    }
  });
});
