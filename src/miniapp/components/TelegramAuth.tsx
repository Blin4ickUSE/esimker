import { useEffect, useRef, type CSSProperties } from "react";
import { X } from "lucide-react";
import { useI18n } from "./i18n";

export interface TelegramLoginUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

interface TelegramAuthModalProps {
  open: boolean;
  botUsername: string;
  onClose: () => void;
  onAuth: (user: TelegramLoginUser) => void;
}

export function TelegramAuthModal({ open, botUsername, onClose, onAuth }: TelegramAuthModalProps) {
  const { t } = useI18n();
  const widgetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !widgetRef.current) return;

    const handler = (user: TelegramLoginUser) => {
      onAuth(user);
    };
    (window as Window & { onTelegramAuth?: (user: TelegramLoginUser) => void }).onTelegramAuth = handler;

    widgetRef.current.innerHTML = "";
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.setAttribute("data-telegram-login", botUsername);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "20");
    script.setAttribute("data-onauth", "onTelegramAuth(user)");
    script.setAttribute("data-request-access", "write");
    widgetRef.current.appendChild(script);

    return () => {
      delete (window as Window & { onTelegramAuth?: (user: TelegramLoginUser) => void }).onTelegramAuth;
    };
  }, [open, botUsername, onAuth]);

  if (!open) return null;

  return (
    <div style={s.backdrop} onClick={onClose}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>
        <button type="button" style={s.close} onClick={onClose} aria-label={t("back")}>
          <X size={18} />
        </button>
        <div style={s.title}>{t("authTitle")}</div>
        <div style={s.sub}>{t("authSub")}</div>
        <div style={s.widgetWrap}>
          <div ref={widgetRef} style={s.widget} />
        </div>
        <a href={`https://t.me/${botUsername}`} target="_blank" rel="noopener noreferrer" style={s.botLink}>
          {t("authOpenBot")}
        </a>
      </div>
    </div>
  );
}

const s: Record<string, CSSProperties> = {
  backdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 1000,
    background: "rgba(0,0,0,.55)",
    display: "grid",
    placeItems: "center",
    padding: 20,
  },
  modal: {
    position: "relative",
    width: "100%",
    maxWidth: 360,
    background: "var(--surface)",
    border: "1px solid var(--line)",
    borderRadius: "var(--r-xl)",
    padding: "28px 24px 24px",
    textAlign: "center",
    boxShadow: "0 24px 48px rgba(0,0,0,.35)",
  },
  close: {
    position: "absolute",
    top: 14,
    right: 14,
    width: 32,
    height: 32,
    border: "1px solid var(--line-strong)",
    borderRadius: "var(--r-md)",
    background: "var(--surface-2)",
    color: "var(--text-dim)",
    display: "grid",
    placeItems: "center",
    cursor: "pointer",
  },
  title: {
    fontSize: "var(--fs-2xl)",
    fontWeight: 700,
    marginBottom: 8,
    letterSpacing: "-.5px",
  },
  sub: {
    fontSize: "var(--fs-md)",
    color: "var(--text-dim)",
    marginBottom: 24,
    lineHeight: 1.45,
  },
  widgetWrap: {
    minHeight: 48,
    display: "grid",
    placeItems: "center",
    marginBottom: 16,
  },
  widget: {
    display: "flex",
    justifyContent: "center",
    width: "100%",
  },
  botLink: {
    display: "inline-block",
    fontSize: "var(--fs-md)",
    fontWeight: 600,
    color: "var(--accent)",
    textDecoration: "none",
  },
};
