import { useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, Gift, Globe, Settings, Smartphone, Users, Wallet } from "lucide-react";
import { useI18n, formatUsd, useAccount, paths, Screen, SectionLabel, SettingsToggles } from "../components/i18n";

export default function Home() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const { balanceUsd, esims, activatePromo, requireAuth } = useAccount();

  const [code, setCode] = useState("");
  const [hint, setHint] = useState<{ ok: boolean; text: string } | null>(null);

  const onPromo = () => {
    requireAuth(async () => {
      try {
        const res = await activatePromo(code);
        if (res === "ok") {
          setHint({ ok: true, text: t("promoOk") });
          setCode("");
        } else {
          setHint({ ok: false, text: res === "used" ? t("promoUsed") : t("promoBad") });
        }
      } catch {
        setHint({ ok: false, text: t("promoBad") });
      }
    });
  };

  return (
    <Screen pad="16px 16px 32px">
      <div className="home-in home-in-1" style={s.top}>
        <div style={s.brand}>
          {t("brand")}
          <span style={{ color: "var(--accent)" }}>.</span>
        </div>
        <SettingsToggles />
      </div>

      <div className="home-in home-in-2" style={s.balanceCard}>
        <div style={s.balanceGlow} />
        <div style={s.balanceLabel}>
          <Wallet size={14} /> {t("balance")}
        </div>
        <div style={s.balanceValue}>{formatUsd(balanceUsd)}</div>
        <button style={s.topUpBtn} onClick={() => requireAuth(() => navigate(paths.replenishment))}>
          {t("topUp")}
        </button>
      </div>

      <button className="home-in home-in-3" style={s.buyBtn} onClick={() => navigate(paths.buy)}>
        <Globe size={22} />
        <div style={{ textAlign: "left", flex: 1 }}>
          <div style={s.buyTitle}>{t("buyEsim")}</div>
          <div style={s.buySub}>{t("buyEsimSub")}</div>
        </div>
        <ChevronRight size={20} />
      </button>

      <div className="home-in home-in-4" style={s.tileRow}>
        <button style={s.tile} onClick={() => requireAuth(() => navigate(paths.myEsims))}>
          <div style={s.tileIcon}>
            <Smartphone size={18} />
          </div>
          <div style={s.tileName}>{t("myEsims")}</div>
          <div style={s.tileCount}>{esims.length}</div>
        </button>
        <button style={s.tile} onClick={() => requireAuth(() => navigate(paths.referral))}>
          <div style={s.tileIcon}>
            <Users size={18} />
          </div>
          <div style={s.tileName}>{t("referral")}</div>
        </button>
      </div>

      <button className="home-in home-in-5" style={s.tileWide} onClick={() => requireAuth(() => navigate(paths.settings))}>
        <div style={s.tileIcon}>
          <Settings size={18} />
        </div>
        <div style={s.tileName}>{t("settings")}</div>
        <ChevronRight size={18} color="var(--text-dim)" />
      </button>

      <div className="home-in home-in-6">
      <SectionLabel>
        <Gift size={13} color="var(--accent)" /> {t("promo")}
      </SectionLabel>
      </div>
      <div className="home-in home-in-7" style={s.promoRow}>
        <input
          style={s.promoInput}
          placeholder={t("promoPlaceholder")}
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setHint(null);
          }}
          onKeyDown={(e) => e.key === "Enter" && onPromo()}
        />
        <button style={s.promoBtn} onClick={onPromo} disabled={!code.trim()}>
          {t("activate")}
        </button>
      </div>
      {hint && (
        <div
          style={{
            ...s.hint,
            color: hint.ok ? "var(--accent)" : "var(--text-dim)",
          }}
        >
          {hint.text}
        </div>
      )}
    </Screen>
  );
}

const card: CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--line)",
  borderRadius: "var(--r-xl)",
};

const s: Record<string, CSSProperties> = {
  top: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  brand: { fontSize: "var(--fs-2xl)", fontWeight: 700, letterSpacing: "-.5px" },

  balanceCard: {
    position: "relative",
    overflow: "hidden",
    ...card,
    padding: "18px 20px 20px",
    marginBottom: 14,
  },
  balanceGlow: {
    position: "absolute",
    top: -60,
    right: -40,
    width: 180,
    height: 180,
    borderRadius: "50%",
    background:
      "radial-gradient(circle, rgba(255,138,61,.22), transparent 70%)",
    pointerEvents: "none",
  },
  balanceLabel: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: "var(--fs-sm)",
    color: "var(--text-dim)",
    textTransform: "uppercase",
    letterSpacing: ".6px",
    fontWeight: 700,
    marginBottom: 8,
  },
  balanceValue: {
    fontSize: 34,
    fontWeight: 700,
    letterSpacing: "-1px",
    marginBottom: 14,
  },
  topUpBtn: {
    border: "1px solid var(--line-strong)",
    background: "var(--surface-2)",
    color: "var(--text)",
    borderRadius: "var(--r-md)",
    padding: "9px 16px",
    fontSize: "var(--fs-md)",
    fontWeight: 700,
    cursor: "pointer",
  },

  buyBtn: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: 14,
    border: "none",
    borderRadius: "var(--r-xl)",
    padding: "16px 18px",
    marginBottom: 12,
    cursor: "pointer",
    color: "var(--accent-ink)",
    background: "linear-gradient(135deg,var(--accent),var(--accent-2))",
  },
  buyTitle: { fontSize: "var(--fs-lg)", fontWeight: 700 },
  buySub: { fontSize: "var(--fs-sm)", fontWeight: 600, opacity: 0.85 },

  tileRow: { display: "flex", gap: 10, marginBottom: 10 },
  tileWide: {
    width: "100%",
    ...card,
    borderRadius: "var(--r-lg)",
    padding: "14px 15px",
    marginBottom: 22,
    cursor: "pointer",
    color: "var(--text)",
    display: "flex",
    alignItems: "center",
    gap: 11,
    border: "1px solid var(--line)",
    background: "var(--surface)",
  },
  tile: {
    flex: 1,
    ...card,
    borderRadius: "var(--r-lg)",
    padding: "14px 15px",
    cursor: "pointer",
    color: "var(--text)",
    display: "flex",
    alignItems: "center",
    gap: 11,
  },
  tileIcon: {
    width: 34,
    height: 34,
    borderRadius: "var(--r-sm)",
    background: "var(--chip)",
    display: "grid",
    placeItems: "center",
    color: "var(--accent)",
    flexShrink: 0,
  },
  tileName: { fontSize: "var(--fs-md)", fontWeight: 700, flex: 1, textAlign: "left" },
  tileCount: { fontSize: "var(--fs-lg)", fontWeight: 700, color: "var(--text-dim)" },

  promoRow: { display: "flex", gap: 9 },
  promoInput: {
    flex: 1,
    background: "var(--surface)",
    border: "1px solid var(--line-strong)",
    borderRadius: "var(--r-md)",
    padding: "12px 14px",
    color: "var(--text)",
    fontSize: "var(--fs-base)",
    outline: "none",
  },
  promoBtn: {
    border: "none",
    borderRadius: "var(--r-md)",
    padding: "0 18px",
    background: "var(--accent-tint)",
    color: "var(--accent)",
    fontSize: "var(--fs-md)",
    fontWeight: 700,
    cursor: "pointer",
  },
  hint: { fontSize: "var(--fs-md)", fontWeight: 600, margin: "10px 2px 0" },
};
