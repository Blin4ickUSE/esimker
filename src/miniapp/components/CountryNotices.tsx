import { type CSSProperties } from "react";
import { AlertTriangle } from "lucide-react";
import { countryNoticeKeys } from "@assets/catalog";
import { useI18n, type StringKey } from "./i18n";

export function CountryNotices({ country }: { country: string }) {
  const { t } = useI18n();
  const keys = countryNoticeKeys(country);
  if (keys.length === 0) return null;

  return (
    <div style={s.box}>
      {keys.map((key) => (
        <div key={key} style={s.row}>
          <AlertTriangle size={16} color="var(--accent)" style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{t(key as StringKey)}</span>
        </div>
      ))}
    </div>
  );
}

const s: Record<string, CSSProperties> = {
  box: {
    background: "var(--accent-tint)",
    border: "1px solid rgba(255,138,61,.28)",
    borderRadius: "var(--r-lg)",
    padding: "14px 16px",
    marginBottom: 20,
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  row: {
    display: "flex",
    gap: 10,
    fontSize: "var(--fs-sm)",
    color: "var(--text-soft)",
    lineHeight: 1.5,
  },
};
