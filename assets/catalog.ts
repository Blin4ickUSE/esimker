import rawPlans from "./plans.json";

import { buildCountrySearcher } from "./search";



export type Volume = number | "Безлимит";



export interface Plan {

  name_en: string;

  name_ru: string;

  code: string;

  gb: Volume;

  days: number;

  usd: number;

  rub: number;

}



export type Lang = "ru" | "en";



const EXCLUDED = new Set(["Весь мир (Lite)", "Весь мир (Max)"]);



const volOk = (g: Volume): boolean =>

  g === "Безлимит" || (typeof g === "number" && g >= 1);



const plans = (rawPlans as Plan[]).filter(

  (p) => !EXCLUDED.has(p.name_en) && volOk(p.gb),

);



const byCountry = new Map<string, Plan[]>();

const codeByName = new Map<string, string>();

const nameByCode = new Map<string, string>();

const ruByEn = new Map<string, string>();

const minRubByName = new Map<string, number>();

const minUsdByName = new Map<string, number>();



let usdPerRub = 0.014;



for (const p of plans) {

  const key = p.name_en;

  if (!ruByEn.has(key)) ruByEn.set(key, p.name_ru);



  let list = byCountry.get(key);

  if (!list) {

    list = [];

    byCountry.set(key, list);

    codeByName.set(key, p.code);

    nameByCode.set(p.code.toUpperCase(), key);

  }

  list.push(p);

  const curRub = minRubByName.get(key);

  if (curRub === undefined || p.rub < curRub) {

    minRubByName.set(key, p.rub);

    minUsdByName.set(key, p.usd);

  }

}



if (plans.length > 0) {

  const ratios = plans.filter((p) => p.rub > 0).map((p) => p.usd / p.rub);

  usdPerRub = ratios[Math.floor(ratios.length / 2)];

}



export const isRegion = (code: string): boolean => code.length !== 2;

export const codeOf = (name: string): string => codeByName.get(name) ?? "";

export const isCountryProduct = (name: string): boolean =>

  !isRegion(codeOf(name)) && !EXCLUDED.has(name);

export const countryByCode = (code: string): string | undefined =>

  nameByCode.get(code.toUpperCase());

export const minRub = (name: string): number => minRubByName.get(name) ?? 0;

export const minUsd = (name: string): number => minUsdByName.get(name) ?? 0;

export const rubToUsd = (rub: number): number => Math.round(rub * usdPerRub * 100) / 100;

export const plansFor = (name: string): Plan[] => byCountry.get(name) ?? [];



/** Countries hidden on the Russian locale per legal requirements. */
const BLOCKED_IN_RU = new Set(["Ukraine"]);

export const blockedInRu = (name: string): boolean => BLOCKED_IN_RU.has(name);

/** Country-specific warnings shown on purchase and eSIM detail pages. */
export const COUNTRY_NOTICE_KEYS = {
  Russia: ["noticeRuSms", "noticeRuWhitelist"],
  China: ["noticeCnHkMo"],
} as const satisfies Record<string, readonly string[]>;

export type CountryNoticeKey = (typeof COUNTRY_NOTICE_KEYS)[keyof typeof COUNTRY_NOTICE_KEYS][number];

export const countryNoticeKeys = (name: string): readonly CountryNoticeKey[] =>
  (COUNTRY_NOTICE_KEYS as Record<string, readonly CountryNoticeKey[]>)[name] ?? [];



export const countries: string[] = [...byCountry.keys()].filter(isCountryProduct);



const countrySearcher = buildCountrySearcher(countries, codeOf, (name) => ruByEn.get(name) ?? name);



export const displayName = (name: string, lang: Lang): string =>

  lang === "ru" ? ruByEn.get(name) ?? name : name;



export function searchCountries(query: string, lang: Lang): string[] {

  const list = countrySearcher.search(query, lang, sortName);

  return lang === "ru" ? list.filter((c) => !blockedInRu(c)) : list;

}



function sortName(a: string, b: string, lang: Lang): number {

  const da = displayName(a, lang);

  const db = displayName(b, lang);

  if (lang === "ru") {

    const ca = /^[А-Яа-яЁё]/.test(da) ? 0 : 1;

    const cb = /^[А-Яа-яЁё]/.test(db) ? 0 : 1;

    if (ca !== cb) return ca - cb;

  }

  return da.localeCompare(db, lang === "ru" ? "ru" : "en");

}



const volNum = (g: Volume): number => (g === "Безлимит" ? Infinity : g);



export const volumesFor = (name: string): Volume[] =>

  [...new Set(plansFor(name).map((p) => p.gb))].sort(

    (a, b) => volNum(a) - volNum(b),

  );



export const durationsFor = (name: string, gb: Volume): Plan[] =>

  plansFor(name)

    .filter((p) => p.gb === gb)

    .sort((a, b) => a.days - b.days);

