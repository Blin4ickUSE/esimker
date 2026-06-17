import { useEffect, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { Check, ChevronLeft, Copy, Gift, Users, Wallet } from "lucide-react";
import { useAccount, useI18n, formatUsd, paths, Screen, SectionLabel } from "../components/i18n";

export default function Referral() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const { referral } = useAccount();
  const link = referral.link;
  const earnedUsd = referral.earnedUsd;
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(id);
  }, [copied]);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <Screen pad="16px 16px 32px">
      <div style={s.head}>
        <button style={s.back} onClick={() => navigate(paths.home)} aria-label={t("back")}>
          <ChevronLeft size={20} />
        </button>
        <div style={s.title}>{t("referral")}</div>
      </div>

      <div style={s.earnedCard}>
        <div style={s.earnedGlow} />
        <div style={s.earnedLabel}>
          <Wallet size={14} /> {t("referralEarned")}
        </div>
        <div style={s.earnedValue}>{formatUsd(earnedUsd)}</div>
      </div>

      <div style={s.infoCard}>
        <div style={s.infoHead}>
          <div style={s.infoHeadIcon}>
            <Users size={22} />
          </div>
          <div style={s.infoHeadTitle}>{t("referralSub")}</div>
        </div>
        <div style={s.divider} />
        <div style={s.perkRow}>
          <div style={s.perkIcon}>
            <Gift size={18} />
          </div>
          <div>
            <div style={s.perkTitle}>{t("referralFriend")}</div>
            <div style={s.perkDesc}>{t("referralFriendDesc")}</div>
          </div>
        </div>
        <div style={s.divider} />
        <div style={s.perkRow}>
          <div style={s.perkIcon}>
            <Wallet size={18} />
          </div>
          <div>
            <div style={s.perkTitle}>{t("referralYou")}</div>
            <div style={s.perkDesc}>{t("referralYouDesc")}</div>
          </div>
        </div>
      </div>

      <SectionLabel>{t("referralLink")}</SectionLabel>
      <div style={s.linkRow}>
        <input style={s.linkInput} readOnly value={link} aria-label={t("referralLink")} />
        <button style={s.copyBtn} onClick={onCopy} type="button" disabled={!link}>
          {copied ? <Check size={16} /> : <Copy size={16} />}
          {copied ? t("referralCopied") : t("referralCopy")}
        </button>
      </div>
    </Screen>
  );
}

const card: CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--line)",
  borderRadius: "var(--r-xl)",
};

const s: Record<string, CSSProperties> = {
  head: { display: "flex", alignItems: "center", gap: 12, marginBottom: 20 },
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

  earnedCard: {
    position: "relative",
    overflow: "hidden",
    ...card,
    padding: "18px 20px 20px",
    marginBottom: 14,
  },
  earnedGlow: {
    position: "absolute",
    top: -60,
    right: -40,
    width: 180,
    height: 180,
    borderRadius: "50%",
    background: "radial-gradient(circle, rgba(255,138,61,.22), transparent 70%)",
    pointerEvents: "none",
  },
  earnedLabel: {
    position: "relative",
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
  earnedValue: {
    position: "relative",
    fontSize: 34,
    fontWeight: 700,
    letterSpacing: "-1px",
  },

  infoCard: {
    ...card,
    padding: "16px 16px",
    marginBottom: 22,
  },
  infoHead: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: "4px 2px 2px",
  },
  infoHeadIcon: {
    width: 48,
    height: 48,
    borderRadius: "50%",
    background: "var(--accent-tint)",
    color: "var(--accent)",
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
  },
  infoHeadTitle: {
    fontSize: "var(--fs-md)",
    fontWeight: 700,
    lineHeight: 1.4,
    color: "var(--text-soft)",
  },
  divider: {
    height: 1,
    background: "var(--line)",
    margin: "14px 0",
  },
  perkRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 13,
    padding: "2px",
  },
  perkIcon: {
    width: 38,
    height: 38,
    borderRadius: "var(--r-md)",
    background: "var(--chip)",
    color: "var(--accent)",
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
  },
  perkTitle: { fontSize: "var(--fs-md)", fontWeight: 700, marginBottom: 3 },
  perkDesc: { fontSize: "var(--fs-sm)", color: "var(--text-soft)", lineHeight: 1.45 },

  linkRow: { display: "flex", gap: 9 },
  linkInput: {
    flex: 1,
    minWidth: 0,
    background: "var(--surface)",
    border: "1px solid var(--line-strong)",
    borderRadius: "var(--r-md)",
    padding: "12px 14px",
    color: "var(--text-dim)",
    fontSize: "var(--fs-sm)",
    outline: "none",
  },
  copyBtn: {
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    border: "none",
    borderRadius: "var(--r-md)",
    padding: "0 16px",
    background: "var(--accent-tint)",
    color: "var(--accent)",
    fontSize: "var(--fs-md)",
    fontWeight: 700,
    cursor: "pointer",
  },
};
