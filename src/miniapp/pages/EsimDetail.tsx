import { useEffect, useState, type CSSProperties } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  AlertCircle,
  Check,
  ChevronLeft,
  Copy,
  Info,
  Smartphone,
} from "lucide-react";
import QRCode from "qrcode";
import type { Lang, Plan, Volume } from "@assets/catalog";
import { displayName } from "@assets/catalog";
import { gbLabel } from "@assets/volume";
import {
  useI18n,
  useAccount,
  paths,
  Flag,
  Screen,
  SectionLabel,
  type Esim,
  type EsimStatus,
  type StringKey,
} from "../components/i18n";

const SMDP = "rsp.esimker.com";

const hash = (s: string): number => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

const genIccid = (seed: string): string => {
  const h = hash(seed);
  const tail = String(h).padStart(15, "0").slice(0, 15);
  let sum = 0;
  const digits = `89${tail}`;
  for (let i = 0; i < 18; i++) {
    const d = parseInt(digits[i] ?? "0", 10);
    sum += i % 2 === 0 ? d : d * 2 > 9 ? d * 2 - 9 : d * 2;
  }
  const check = (10 - (sum % 10)) % 10;
  return `${digits}${check}`;
};

const genActivationCode = (seed: string): string => {
  const h = hash(seed + "act");
  return h.toString(36).toUpperCase().padStart(12, "X").slice(0, 12);
};

const volumeGb = (gb: Volume): number | null => (gb === "Безлимит" ? null : gb);

const normalizeStatus = (raw: string | undefined): EsimStatus => {
  if (raw === "active" || raw === "inactive" || raw === "expired" || raw === "limit") return raw;
  return "inactive";
};

export const createEsim = (plan: Plan, id: string): Esim => {
  const now = Date.now();
  return {
    id,
    name: plan.name_en,
    code: plan.code,
    gb: plan.gb,
    days: plan.days,
    usd: plan.usd,
    purchasedAt: now,
    status: "inactive",
    iccid: genIccid(id),
    smdpAddress: SMDP,
    activationCode: genActivationCode(id),
    dataRemainingGb: volumeGb(plan.gb),
  };
};

type LegacyEsim = Partial<Esim> & {
  id: string;
  name: string;
  code: string;
  gb: Volume;
  days: number;
  usd: number;
  purchasedAt: number;
  status?: string;
};

export const migrateEsim = (e: LegacyEsim): Esim => {
  const status = normalizeStatus(e.status);
  const dataRemainingGb =
    e.dataRemainingGb !== undefined
      ? e.dataRemainingGb
      : status === "limit" || status === "expired"
        ? 0
        : volumeGb(e.gb);
  return {
    id: e.id,
    name: e.name,
    code: e.code,
    gb: e.gb,
    days: e.days,
    usd: e.usd,
    purchasedAt: e.purchasedAt,
    status,
    iccid: e.iccid ?? genIccid(e.id),
    smdpAddress: e.smdpAddress ?? SMDP,
    activationCode: e.activationCode ?? genActivationCode(e.id),
    dataRemainingGb,
    activatedAt: e.activatedAt,
    expiresAt: e.expiresAt,
  };
};

const lpaString = (esim: Pick<Esim, "smdpAddress" | "activationCode">): string =>
  `LPA:1$${esim.smdpAddress}$${esim.activationCode}`;

const iosInstallUrl = (esim: Pick<Esim, "smdpAddress" | "activationCode">): string =>
  `https://esimsetup.apple.com/esim_qrcode_provisioning?carddata=${encodeURIComponent(lpaString(esim))}`;

const androidInstallUrl = (esim: Pick<Esim, "smdpAddress" | "activationCode">): string =>
  `intent://euicc/#Intent;scheme=lpa;S.lpa=${encodeURIComponent(lpaString(esim))};end`;

const formatPurchaseDate = (ts: number, lang: Lang): string =>
  new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : "en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(ts));

const formatDataRemaining = (esim: Esim, lang: Lang): string => {
  if (esim.gb === "Безлимит") return gbLabel("Безлимит", lang);
  return gbLabel(esim.dataRemainingGb ?? 0, lang);
};

const msUntilExpiry = (esim: Esim): number | null => {
  if (esim.status === "inactive") return null;
  if (esim.expiresAt) return esim.expiresAt - Date.now();
  if (esim.activatedAt) return esim.activatedAt + esim.days * 86_400_000 - Date.now();
  return esim.days * 86_400_000;
};

const formatExpiresIn = (
  esim: Esim,
  _lang: Lang,
  t: (key: "days" | "esimHours" | "esimAfterInstall" | "expired") => string,
): string => {
  const ms = msUntilExpiry(esim);
  if (ms === null) return t("esimAfterInstall");
  if (ms <= 0 || esim.status === "expired") return t("expired");
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `${days} ${t("days")}`;
  const hours = Math.max(1, Math.ceil(ms / 3_600_000));
  return `${hours} ${t("esimHours")}`;
};

const NOTE_KEYS: StringKey[] = [
  "esimNoteWifi",
  "esimNoteCountry",
  "esimNoteRoaming",
  "esimNoteStatusDelay",
  "esimNoteTrafficDelay",
  "esimNoteNoTransfer",
];

const statusKey = (s: EsimStatus): StringKey => {
  if (s === "inactive") return "esimStatusInactive";
  if (s === "active") return "active";
  if (s === "limit") return "esimStatusLimit";
  return "expired";
};

const statusStyle = (s: EsimStatus): CSSProperties => {
  if (s === "active") return sStyles.badgeActive;
  if (s === "inactive") return sStyles.badgeInactive;
  if (s === "limit") return sStyles.badgeLimit;
  return sStyles.badgeExpired;
};

function CopyRow({ label, value }: { label: string; value: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(id);
  }, [copied]);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div style={sStyles.copyRow}>
      <div style={sStyles.copyMeta}>
        <div style={sStyles.copyLabel}>{label}</div>
        <div style={sStyles.copyValue}>{value}</div>
      </div>
      <button type="button" style={sStyles.copyBtn} onClick={onCopy} aria-label={t("esimCopy")}>
        {copied ? <Check size={16} /> : <Copy size={16} />}
      </button>
    </div>
  );
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div style={sStyles.infoCell}>
      <div style={sStyles.infoLabel}>{label}</div>
      <div style={sStyles.infoValue}>{value}</div>
    </div>
  );
}

export default function EsimDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t, lang } = useI18n();
  const { esims } = useAccount();
  const esim = esims.find((e) => e.id === id);
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    if (!esim) return;
    let cancelled = false;
    QRCode.toDataURL(lpaString(esim), {
      margin: 1,
      width: 220,
      color: { dark: "#14161b", light: "#ffffff" },
    }).then((url) => {
      if (!cancelled) setQr(url);
    });
    return () => {
      cancelled = true;
    };
  }, [esim]);

  if (!esim) {
    return (
      <Screen pad="16px 16px 32px">
        <div style={sStyles.head}>
          <button style={sStyles.back} onClick={() => navigate(paths.myEsims)} aria-label={t("back")}>
            <ChevronLeft size={20} />
          </button>
          <div style={sStyles.title}>{t("myEsims")}</div>
        </div>
        <div style={sStyles.missing}>{t("esimNotFound")}</div>
      </Screen>
    );
  }

  const onInstall = (url: string) => {
    window.location.href = url;
  };

  return (
    <Screen pad="16px 16px 32px">
      <div style={sStyles.head}>
        <button style={sStyles.back} onClick={() => navigate(paths.myEsims)} aria-label={t("back")}>
          <ChevronLeft size={20} />
        </button>
        <Flag code={esim.code} size={36} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={sStyles.title}>{displayName(esim.name, lang)}</div>
          <div style={sStyles.sub}>
            {formatDataRemaining(esim, lang)} · {esim.days} {t("days")}
          </div>
        </div>
      </div>

      <div style={sStyles.statusCard}>
        <span style={{ ...sStyles.badge, ...statusStyle(esim.status) }}>{t(statusKey(esim.status))}</span>
      </div>

      <div style={sStyles.grid}>
        <InfoCell label={t("esimIccid")} value={esim.iccid} />
        <InfoCell label={t("esimPurchased")} value={formatPurchaseDate(esim.purchasedAt, lang)} />
        <InfoCell label={t("esimDataLeft")} value={formatDataRemaining(esim, lang)} />
        <InfoCell
          label={t("esimExpiresIn")}
          value={formatExpiresIn(esim, lang, t)}
        />
      </div>

      <SectionLabel>{t("esimInstallQr")}</SectionLabel>
      <div style={sStyles.qrCard}>
        {qr ? (
          <img src={qr} width={220} height={220} alt="" style={sStyles.qrImg} />
        ) : (
          <div style={sStyles.qrPlaceholder} />
        )}
      </div>

      <SectionLabel>{t("esimManualInstall")}</SectionLabel>
      <div style={sStyles.card}>
        <CopyRow label={t("esimSmdp")} value={esim.smdpAddress} />
        <div style={sStyles.divider} />
        <CopyRow label={t("esimActivationCode")} value={esim.activationCode} />
        <div style={sStyles.divider} />
        <CopyRow label={t("esimIccid")} value={esim.iccid} />
      </div>

      <div style={sStyles.installRow}>
        <button type="button" style={sStyles.installBtn} onClick={() => onInstall(iosInstallUrl(esim))}>
          <Smartphone size={18} />
          {t("esimInstallIphone")}
        </button>
        <button type="button" style={sStyles.installBtn} onClick={() => onInstall(androidInstallUrl(esim))}>
          <Smartphone size={18} />
          {t("esimInstallAndroid")}
        </button>
      </div>

      <SectionLabel>
        <Info size={13} color="var(--accent)" /> {t("esimNotes")}
      </SectionLabel>
      <div style={sStyles.card}>
        {NOTE_KEYS.map((key, i) => (
          <div key={key}>
            {i > 0 && <div style={sStyles.divider} />}
            <div style={sStyles.noteRow}>
              <AlertCircle size={16} color="var(--text-dim)" style={{ flexShrink: 0, marginTop: 2 }} />
              <span>{t(key)}</span>
            </div>
          </div>
        ))}
      </div>
    </Screen>
  );
}

const card: CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--line)",
  borderRadius: "var(--r-xl)",
};

const sStyles: Record<string, CSSProperties> = {
  head: { display: "flex", alignItems: "center", gap: 12, marginBottom: 16 },
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
  title: { fontSize: "var(--fs-xl)", fontWeight: 700, lineHeight: 1.2 },
  sub: { fontSize: "var(--fs-sm)", color: "var(--text-dim)", marginTop: 2 },

  statusCard: {
    ...card,
    padding: "14px 16px",
    marginBottom: 12,
    display: "flex",
    justifyContent: "center",
  },
  badge: {
    fontSize: "var(--fs-md)",
    fontWeight: 700,
    padding: "8px 16px",
    borderRadius: "var(--r-pill)",
    textTransform: "uppercase",
    letterSpacing: ".5px",
  },
  badgeActive: { background: "var(--accent-tint)", color: "var(--accent)" },
  badgeInactive: { background: "var(--chip)", color: "var(--text-soft)" },
  badgeExpired: { background: "var(--chip)", color: "var(--text-dim)" },
  badgeLimit: { background: "var(--accent-tint)", color: "var(--accent-2)" },

  grid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 9,
    marginBottom: 22,
  },
  infoCell: {
    ...card,
    borderRadius: "var(--r-lg)",
    padding: "12px 14px",
    minWidth: 0,
  },
  infoLabel: {
    fontSize: "var(--fs-xs)",
    color: "var(--text-dim)",
    textTransform: "uppercase",
    letterSpacing: ".5px",
    fontWeight: 700,
    marginBottom: 6,
  },
  infoValue: {
    fontSize: "var(--fs-md)",
    fontWeight: 600,
    lineHeight: 1.35,
    wordBreak: "break-word",
  },

  qrCard: {
    ...card,
    padding: 18,
    marginBottom: 22,
    display: "flex",
    justifyContent: "center",
  },
  qrImg: { borderRadius: "var(--r-md)", display: "block" },
  qrPlaceholder: {
    width: 220,
    height: 220,
    borderRadius: "var(--r-md)",
    background: "var(--surface-2)",
  },

  card: {
    ...card,
    padding: "12px 14px",
    marginBottom: 14,
  },
  divider: { height: 1, background: "var(--line)", margin: "10px 0" },

  copyRow: { display: "flex", alignItems: "center", gap: 10 },
  copyMeta: { flex: 1, minWidth: 0 },
  copyLabel: { fontSize: "var(--fs-xs)", color: "var(--text-dim)", fontWeight: 700, marginBottom: 3 },
  copyValue: {
    fontSize: "var(--fs-sm)",
    fontWeight: 600,
    wordBreak: "break-all",
    fontFamily: "ui-monospace, monospace",
  },
  copyBtn: {
    flexShrink: 0,
    width: 36,
    height: 36,
    border: "1px solid var(--line-strong)",
    borderRadius: "var(--r-md)",
    background: "var(--surface-2)",
    color: "var(--text)",
    display: "grid",
    placeItems: "center",
    cursor: "pointer",
  },

  installRow: { display: "flex", gap: 9, marginBottom: 22 },
  installBtn: {
    flex: 1,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    border: "none",
    borderRadius: "var(--r-lg)",
    padding: "13px 12px",
    cursor: "pointer",
    background: "linear-gradient(135deg,var(--accent),var(--accent-2))",
    color: "var(--accent-ink)",
    fontSize: "var(--fs-sm)",
    fontWeight: 700,
    lineHeight: 1.25,
  },

  noteRow: {
    display: "flex",
    gap: 10,
    fontSize: "var(--fs-sm)",
    color: "var(--text-soft)",
    lineHeight: 1.45,
    padding: "2px 0",
  },

  missing: {
    textAlign: "center",
    color: "var(--text-dim)",
    padding: "48px 16px",
    fontSize: "var(--fs-md)",
  },
};
