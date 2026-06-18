import { useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bell,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  Mail,
  MessageCircle,
  Shield,
  X,
} from "lucide-react";
import { useAccount, useI18n, paths, Screen, SectionLabel } from "../components/i18n";
import { getLegalDoc, renderLegalMarkdown } from "../legal";

const APP_VERSION = "v0.2 (beta)";
const SUPPORT_URL = "https://t.me/esimkerteambot";

function Toggle({
  on,
  onToggle,
  label,
}: {
  on: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button type="button" style={s.toggleRow} onClick={onToggle} aria-pressed={on}>
      <span style={s.toggleLabel}>{label}</span>
      <span style={{ ...s.toggle, ...(on ? s.toggleOn : null) }} aria-hidden>
        <span style={{ ...s.toggleKnob, ...(on ? s.toggleKnobOn : null) }} />
      </span>
    </button>
  );
}

function DocModal({ title, body, onClose }: { title: string; body: string; onClose: () => void }) {
  return (
    <div style={s.modalBackdrop} onClick={onClose}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>
        <div style={s.modalHead}>
          <div style={s.modalTitle}>{title}</div>
          <button type="button" style={s.modalClose} onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div
          style={s.modalBody}
          dangerouslySetInnerHTML={{ __html: renderLegalMarkdown(body) }}
        />
      </div>
    </div>
  );
}

export default function Settings() {
  const navigate = useNavigate();
  const { t, lang } = useI18n();
  const { settings, updateSettings, unlinkEmail, confirmEmail } = useAccount();
  const data = settings;
  const [emailDraft, setEmailDraft] = useState("");
  const [codeDraft, setCodeDraft] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [editingEmail, setEditingEmail] = useState(false);
  const [hint, setHint] = useState<{ ok: boolean; text: string } | null>(null);
  const [doc, setDoc] = useState<"terms" | "privacy" | null>(null);

  const save = async (patch: Parameters<typeof updateSettings>[0]) => {
    await updateSettings(patch);
  };

  const resetEmailForm = () => {
    setEmailDraft("");
    setCodeDraft("");
    setCodeSent(false);
    setEditingEmail(false);
    setHint(null);
  };

  const onSendCode = () => {
    const email = emailDraft.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setHint({ ok: false, text: t("settingsEmailInvalid") });
      return;
    }
    setCodeSent(true);
    setHint({ ok: true, text: t("settingsEmailSent") });
  };

  const onConfirmCode = async () => {
    const email = emailDraft.trim();
    if (!codeSent || codeDraft.trim().length < 4) {
      setHint({ ok: false, text: t("settingsEmailInvalid") });
      return;
    }
    await confirmEmail(email, codeDraft.trim());
    resetEmailForm();
    setHint({ ok: true, text: t("settingsEmailOk") });
  };

  const onUnlink = async () => {
    await unlinkEmail();
    resetEmailForm();
    setHint({ ok: true, text: t("settingsEmailUnlinked") });
  };

  const openSupport = () => {
    window.open(SUPPORT_URL, "_blank", "noopener,noreferrer");
  };

  return (
    <Screen pad="16px 16px 32px">
      <div style={s.head}>
        <button style={s.back} onClick={() => navigate(paths.home)} aria-label={t("back")}>
          <ChevronLeft size={20} />
        </button>
        <div style={s.title}>{t("settings")}</div>
      </div>

      <SectionLabel>
        <Mail size={13} color="var(--accent)" /> {t("settingsEmail")}
      </SectionLabel>
      <div style={s.card}>
        {data.email && !editingEmail ? (
          <>
            <div style={s.emailValue}>{data.email}</div>
            <div style={s.emailActions}>
              <button type="button" style={s.btnSecondary} onClick={() => setEditingEmail(true)}>
                {t("settingsEmailChange")}
              </button>
              <button type="button" style={s.btnGhost} onClick={onUnlink}>
                {t("settingsEmailUnlink")}
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={s.emailHint}>{data.email ? t("settingsEmailChange") : t("settingsEmailNone")}</div>
            <input
              style={s.input}
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder={t("settingsEmailPlaceholder")}
              value={emailDraft}
              onChange={(e) => {
                setEmailDraft(e.target.value);
                setHint(null);
              }}
            />
            {!codeSent ? (
              <button type="button" style={s.btnPrimary} onClick={onSendCode} disabled={!emailDraft.trim()}>
                {t("settingsEmailSendCode")}
              </button>
            ) : (
              <>
                <input
                  style={s.input}
                  inputMode="numeric"
                  placeholder={t("settingsEmailCodePlaceholder")}
                  value={codeDraft}
                  onChange={(e) => {
                    setCodeDraft(e.target.value.replace(/\D/g, "").slice(0, 6));
                    setHint(null);
                  }}
                />
                <button type="button" style={s.btnPrimary} onClick={onConfirmCode} disabled={codeDraft.length < 4}>
                  {t("settingsEmailConfirm")}
                </button>
              </>
            )}
            {editingEmail && (
              <button type="button" style={s.btnGhost} onClick={resetEmailForm}>
                {t("back")}
              </button>
            )}
          </>
        )}
        {hint && (
          <div style={{ ...s.hint, color: hint.ok ? "var(--accent)" : "var(--text-dim)" }}>{hint.text}</div>
        )}
      </div>

      <SectionLabel>
        <Bell size={13} color="var(--accent)" /> {t("settingsNotifications")}
      </SectionLabel>
      <div style={s.card}>
        <Toggle
          label={t("settingsNotifyNews")}
          on={data.notifications.news}
          onToggle={() =>
            void save({
              notifications: { ...data.notifications, news: !data.notifications.news },
            })
          }
        />
        <div style={s.divider} />
        <Toggle
          label={t("settingsNotifyMarketing")}
          on={data.notifications.marketing}
          onToggle={() =>
            void save({
              notifications: { ...data.notifications, marketing: !data.notifications.marketing },
            })
          }
        />
        <div style={s.divider} />
        <Toggle
          label={t("settingsNotifyTraffic")}
          on={data.notifications.traffic}
          onToggle={() =>
            void save({
              notifications: { ...data.notifications, traffic: !data.notifications.traffic },
            })
          }
        />
      </div>

      <SectionLabel>{t("settingsLegal")}</SectionLabel>
      <div style={s.card}>
        <button type="button" style={s.linkRow} onClick={() => setDoc("terms")}>
          <FileText size={18} color="var(--accent)" />
          <span style={s.linkLabel}>{t("settingsTerms")}</span>
          <ChevronRight size={18} color="var(--text-dim)" />
        </button>
        <div style={s.divider} />
        <button type="button" style={s.linkRow} onClick={() => setDoc("privacy")}>
          <Shield size={18} color="var(--accent)" />
          <span style={s.linkLabel}>{t("settingsPrivacy")}</span>
          <ChevronRight size={18} color="var(--text-dim)" />
        </button>
        <div style={s.divider} />
        <button type="button" style={s.linkRow} onClick={openSupport}>
          <MessageCircle size={18} color="var(--accent)" />
          <span style={s.linkLabel}>{t("settingsSupport")}</span>
          <ExternalLink size={16} color="var(--text-dim)" />
        </button>
      </div>

      <div style={s.version}>{APP_VERSION}</div>

      {doc === "terms" && (
        <DocModal
          title={t("settingsTerms")}
          body={getLegalDoc(lang, "terms")}
          onClose={() => setDoc(null)}
        />
      )}
      {doc === "privacy" && (
        <DocModal
          title={t("settingsPrivacy")}
          body={getLegalDoc(lang, "privacy")}
          onClose={() => setDoc(null)}
        />
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

  card: {
    ...card,
    padding: "14px 16px",
    marginBottom: 22,
  },
  divider: {
    height: 1,
    background: "var(--line)",
    margin: "12px 0",
  },

  emailHint: {
    fontSize: "var(--fs-sm)",
    color: "var(--text-soft)",
    marginBottom: 12,
    lineHeight: 1.45,
  },
  emailValue: {
    fontSize: "var(--fs-lg)",
    fontWeight: 700,
    marginBottom: 14,
    wordBreak: "break-all",
  },
  emailActions: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
  },
  input: {
    width: "100%",
    boxSizing: "border-box",
    background: "var(--surface-2)",
    border: "1px solid var(--line-strong)",
    borderRadius: "var(--r-md)",
    padding: "12px 14px",
    color: "var(--text)",
    fontSize: "var(--fs-base)",
    outline: "none",
    marginBottom: 10,
  },
  btnPrimary: {
    width: "100%",
    border: "none",
    borderRadius: "var(--r-md)",
    padding: "12px 16px",
    background: "linear-gradient(135deg,var(--accent),var(--accent-2))",
    color: "var(--accent-ink)",
    fontSize: "var(--fs-md)",
    fontWeight: 700,
    cursor: "pointer",
    marginBottom: 8,
  },
  btnSecondary: {
    border: "1px solid var(--line-strong)",
    background: "var(--surface-2)",
    color: "var(--text)",
    borderRadius: "var(--r-md)",
    padding: "9px 14px",
    fontSize: "var(--fs-md)",
    fontWeight: 700,
    cursor: "pointer",
  },
  btnGhost: {
    border: "none",
    background: "transparent",
    color: "var(--text-dim)",
    borderRadius: "var(--r-md)",
    padding: "9px 14px",
    fontSize: "var(--fs-md)",
    fontWeight: 600,
    cursor: "pointer",
  },
  hint: {
    fontSize: "var(--fs-sm)",
    fontWeight: 600,
    marginTop: 8,
  },

  toggleRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    width: "100%",
    border: "none",
    background: "transparent",
    color: "var(--text)",
    cursor: "pointer",
    padding: "2px 0",
    textAlign: "left",
  },
  toggleLabel: {
    fontSize: "var(--fs-md)",
    fontWeight: 600,
    lineHeight: 1.35,
    flex: 1,
  },
  toggle: {
    width: 46,
    height: 28,
    borderRadius: 999,
    background: "var(--surface-2)",
    border: "1.5px solid var(--line-strong)",
    position: "relative",
    flexShrink: 0,
    transition: "background .2s, border-color .2s",
  },
  toggleOn: {
    background: "var(--accent-tint)",
    borderColor: "var(--accent)",
  },
  toggleKnob: {
    position: "absolute",
    top: 3,
    left: 3,
    width: 20,
    height: 20,
    borderRadius: "50%",
    background: "var(--text-dim)",
    transition: "transform .2s, background .2s",
  },
  toggleKnobOn: {
    transform: "translateX(18px)",
    background: "var(--accent)",
  },

  linkRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    width: "100%",
    border: "none",
    background: "transparent",
    color: "var(--text)",
    cursor: "pointer",
    padding: "4px 0",
    textAlign: "left",
  },
  linkLabel: {
    flex: 1,
    fontSize: "var(--fs-md)",
    fontWeight: 600,
  },

  version: {
    textAlign: "center",
    fontSize: "var(--fs-sm)",
    color: "var(--text-dim)",
    fontWeight: 600,
    marginTop: 4,
  },

  modalBackdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,.55)",
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "center",
    padding: 16,
    zIndex: 100,
  },
  modal: {
    width: "100%",
    maxWidth: "var(--maxw)",
    maxHeight: "min(78dvh, 640px)",
    background: "var(--surface)",
    border: "1px solid var(--line)",
    borderRadius: "var(--r-xl)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  modalHead: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "14px 16px",
    borderBottom: "1px solid var(--line)",
  },
  modalTitle: {
    flex: 1,
    fontSize: "var(--fs-lg)",
    fontWeight: 700,
  },
  modalClose: {
    width: 34,
    height: 34,
    border: "1px solid var(--line-strong)",
    borderRadius: "var(--r-md)",
    background: "var(--surface-2)",
    color: "var(--text)",
    display: "grid",
    placeItems: "center",
    cursor: "pointer",
  },
  modalBody: {
    padding: "16px",
    overflowY: "auto",
    fontSize: "var(--fs-sm)",
    color: "var(--text-soft)",
    lineHeight: 1.55,
  },
};
