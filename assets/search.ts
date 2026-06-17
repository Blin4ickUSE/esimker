import { aliasesByCountry } from "./searchaliases";
import type { Lang } from "./catalog";

const ALIASES = aliasesByCountry();

export function normSearch(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function trigrams(s: string): string[] {
  const t = `  ${s}  `;
  const out: string[] = [];
  for (let i = 0; i < t.length - 2; i++) out.push(t.slice(i, i + 3));
  return out;
}

function triSimilarity(query: string, document: string): number {
  const qt = trigrams(query);
  if (qt.length === 0) return 0;
  const dt = new Set(trigrams(document));
  let hit = 0;
  for (const g of qt) if (dt.has(g)) hit++;
  return hit / qt.length;
}

interface SearchEntry {
  country: string;
  terms: Set<string>;
  document: string;
}

export interface CountrySearcher {
  search(
    query: string,
    lang: Lang,
    sort: (a: string, b: string, lang: Lang) => number,
  ): string[];
}

export function buildCountrySearcher(
  countries: string[],
  codeOf: (name: string) => string,
  nameRu: (name: string) => string,
): CountrySearcher {
  const aliasToCountry = new Map<string, string>();
  for (const [country, list] of ALIASES) {
    for (const alias of list) aliasToCountry.set(normSearch(alias), country);
  }

  const entries = new Map<string, SearchEntry>();

  for (const country of countries) {
    const terms = new Set<string>();
    const add = (raw: string | undefined) => {
      const n = normSearch(raw ?? "");
      if (n) terms.add(n);
    };

    add(country);
    add(nameRu(country));
    add(codeOf(country));
    for (const alias of ALIASES.get(country) ?? []) add(alias);

    entries.set(country, {
      country,
      terms,
      document: [...terms].join(" "),
    });
  }

  const triIndex = new Map<string, Set<string>>();
  for (const [country, entry] of entries) {
    const seen = new Set<string>();
    for (const g of trigrams(entry.document)) {
      if (seen.has(g)) continue;
      seen.add(g);
      let set = triIndex.get(g);
      if (!set) {
        set = new Set();
        triIndex.set(g, set);
      }
      set.add(country);
    }
  }

  function score(country: string, q: string): number {
    const entry = entries.get(country);
    if (!entry || !q) return 0;

    if (aliasToCountry.get(q) === country) return 1200;

    if (entry.terms.has(q)) return 1000;

    for (const t of entry.terms) {
      if (t.startsWith(q)) return 700 + Math.round((q.length / t.length) * 200);
    }

    for (const t of entry.terms) {
      if (t.includes(q)) return 400;
    }

    if (q.length >= 2) {
      const sim = triSimilarity(q, entry.document);
      const min = q.length >= 4 ? 0.28 : 0.38;
      if (sim >= min) return Math.round(sim * 250);
    }

    return 0;
  }

  function candidates(q: string): Set<string> {
    const out = new Set<string>();
    const direct = aliasToCountry.get(q);
    if (direct && entries.has(direct)) out.add(direct);

    for (const [country, entry] of entries) {
      for (const t of entry.terms) {
        if (t.includes(q)) out.add(country);
      }
    }

    if (q.length >= 2) {
      const qt = trigrams(q);
      const counts = new Map<string, number>();
      for (const g of qt) {
        const set = triIndex.get(g);
        if (!set) continue;
        for (const c of set) counts.set(c, (counts.get(c) ?? 0) + 1);
      }
      const need = Math.max(1, Math.ceil(qt.length * 0.34));
      for (const [c, n] of counts) {
        if (n >= need) out.add(c);
      }
    }

    return out;
  }

  return {
    search(query, lang, sort) {
      const q = normSearch(query);
      if (!q) return [...countries].sort((a, b) => sort(a, b, lang));

      const pool = candidates(q);
      const ranked = [...pool]
        .map((country) => ({ country, s: score(country, q) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s || sort(a.country, b.country, lang));

      return ranked.map((x) => x.country);
    },
  };
}
