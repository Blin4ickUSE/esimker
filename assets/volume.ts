import type { Lang, Volume } from "./catalog";

const UNIT = {
  ru: { mb: "МБ", gb: "ГБ", unlimited: "Безлимит" },
  en: { mb: "MB", gb: "GB", unlimited: "Unlimited" },
} as const;

/** Full label, e.g. "5 ГБ", "500 МБ", "∞ Безлимит". */
export function gbLabel(gb: Volume, lang: Lang): string {
  const u = UNIT[lang];
  if (gb === "Безлимит") return `∞ ${u.unlimited}`;
  return gb < 1 ? `${Math.round(gb * 1000)} ${u.mb}` : `${gb} ${u.gb}`;
}

/** Compact label for the tick row, e.g. "5", "500М", "∞". */
export function gbShort(gb: Volume, lang: Lang): string {
  if (gb === "Безлимит") return "∞";
  const m = lang === "ru" ? "М" : "M";
  return gb < 1 ? `${Math.round(gb * 1000)}${m}` : `${gb}`;
}
