import type { CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, Smartphone } from "lucide-react";
import { useI18n, useAccount, paths, Flag, Screen, type EsimStatus, type StringKey } from "../components/i18n";
import { displayName } from "@assets/catalog";
import { gbLabel } from "@assets/volume";

const statusKey = (s: EsimStatus): StringKey => {
  if (s === "inactive") return "esimStatusInactive";
  if (s === "active") return "active";
  if (s === "limit") return "esimStatusLimit";
  return "expired";
};

const badgeStyle = (s: EsimStatus): CSSProperties => {
  if (s === "active") return st.badgeActive;
  if (s === "inactive") return st.badgeInactive;
  if (s === "limit") return st.badgeLimit;
  return st.badgeExpired;
};

export default function MyEsims() {
  const navigate = useNavigate();
  const { t, lang } = useI18n();
  const { esims } = useAccount();

  return (
    <Screen>
      <div style={st.head}>
        <button style={st.back} onClick={() => navigate(paths.home)} aria-label={t("back")}>
          <ChevronLeft size={20} />
        </button>
        <div style={st.title}>{t("myEsims")}</div>
      </div>

      {esims.length === 0 ? (
        <div style={st.empty}>
          <div style={st.emptyIcon}>
            <Smartphone size={26} />
          </div>
          <div style={st.emptyText}>{t("myEsimsEmpty")}</div>
          <button style={st.emptyBtn} onClick={() => navigate(paths.buy)}>
            {t("myEsimsEmptyCta")}
          </button>
        </div>
      ) : (
        <div style={st.list}>
          {esims.map((e) => (
            <button
              key={e.id}
              type="button"
              style={st.card}
              onClick={() => navigate(paths.esim(e.id))}
            >
              <Flag code={e.code} size={34} />
              <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                <div style={st.name}>{displayName(e.name, lang)}</div>
                <div style={st.meta}>
                  {gbLabel(e.gb, lang)} · {e.days} {t("days")}
                </div>
              </div>
              <span style={{ ...st.badge, ...badgeStyle(e.status) }}>{t(statusKey(e.status))}</span>
              <ChevronRight size={18} color="var(--text-dim)" style={{ flexShrink: 0 }} />
            </button>
          ))}
        </div>
      )}
    </Screen>
  );
}

const st: Record<string, CSSProperties> = {
  head: { display: "flex", alignItems: "center", gap: 12, marginBottom: 18 },
  back: {
    background: "var(--surface)",
    border: "1px solid var(--line-strong)",
    borderRadius: "var(--r-md)",
    width: 38,
    height: 38,
    display: "grid",
    placeItems: "center",
    color: "var(--text)",
    cursor: "pointer",
    flexShrink: 0,
  },
  title: { fontSize: "var(--fs-xl)", fontWeight: 700 },

  list: { display: "flex", flexDirection: "column", gap: 9 },
  card: {
    display: "flex",
    alignItems: "center",
    gap: 13,
    background: "var(--surface)",
    border: "1px solid var(--line)",
    borderRadius: "var(--r-lg)",
    padding: "13px 15px",
    cursor: "pointer",
    color: "var(--text)",
    width: "100%",
    textAlign: "left",
  },
  name: { fontSize: "var(--fs-lg)", fontWeight: 600 },
  meta: { fontSize: "var(--fs-sm)", color: "var(--text-dim)", marginTop: 2 },
  badge: {
    fontSize: "var(--fs-xs)",
    fontWeight: 700,
    padding: "5px 10px",
    borderRadius: "var(--r-pill)",
    textTransform: "uppercase",
    letterSpacing: ".4px",
    flexShrink: 0,
  },
  badgeActive: { background: "var(--accent-tint)", color: "var(--accent)" },
  badgeInactive: { background: "var(--chip)", color: "var(--text-soft)" },
  badgeExpired: { background: "var(--chip)", color: "var(--text-dim)" },
  badgeLimit: { background: "var(--accent-tint)", color: "var(--accent-2)" },

  empty: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 14,
    textAlign: "center",
    padding: "56px 20px",
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: "50%",
    background: "var(--surface)",
    border: "1px solid var(--line)",
    display: "grid",
    placeItems: "center",
    color: "var(--accent)",
  },
  emptyText: { fontSize: "var(--fs-lg)", color: "var(--text-soft)" },
  emptyBtn: {
    border: "none",
    borderRadius: "var(--r-md)",
    padding: "12px 20px",
    background: "linear-gradient(135deg,var(--accent),var(--accent-2))",
    color: "var(--accent-ink)",
    fontSize: "var(--fs-md)",
    fontWeight: 700,
    cursor: "pointer",
    boxShadow: "var(--shadow)",
  },
};
