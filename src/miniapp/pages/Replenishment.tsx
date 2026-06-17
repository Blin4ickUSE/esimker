import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { useAccount, useI18n, formatUsd, paths, Screen } from "../components/i18n";

const PRESETS = [1, 3, 5, 10, 20, 50, 100, 200, 500, 1000];
const MIN_USD = 1;
const MAX_USD = 1000;

const clampUsd = (n: number) =>
  Math.round(Math.min(MAX_USD, Math.max(MIN_USD, n)) * 100) / 100;

const parseDraft = (raw: string): number | null => {
  const n = parseFloat(raw.replace(",", ".").trim());
  return Number.isFinite(n) ? n : null;
};

export default function Replenishment() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const { createPaymentIntent } = useAccount();
  const [amount, setAmount] = useState(PRESETS[2]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [paying, setPaying] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const startEdit = () => {
    setDraft(Number.isInteger(amount) ? String(amount) : amount.toFixed(2));
    setEditing(true);
  };

  const commitEdit = () => {
    const n = parseDraft(draft);
    if (n != null) setAmount(clampUsd(n));
    setEditing(false);
  };

  const onPay = async () => {
    if (paying) return;
    setPaying(true);
    try {
      const intent = await createPaymentIntent({ kind: "topup", amount });
      navigate(paths.payment(intent.id));
    } finally {
      setPaying(false);
    }
  };

  return (
    <div style={s.page}>
      <div style={s.scroll}>
        <Screen pad="16px 16px 12px">
          <div style={s.head}>
            <button style={s.back} onClick={() => navigate(paths.home)} aria-label={t("back")}>
              <ChevronLeft size={20} />
            </button>
            <div style={s.title}>{t("topUp")}</div>
          </div>

          <div style={s.amountCard}>
            <div style={s.amountGlow} />
            <div style={s.amountLabel}>{t("topUpSelect")}</div>
            {editing ? (
              <input
                ref={inputRef}
                style={s.amountInput}
                value={draft}
                onChange={(e) => setDraft(e.target.value.replace(/[^\d.,]/g, ""))}
                onBlur={commitEdit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitEdit();
                  if (e.key === "Escape") setEditing(false);
                }}
                inputMode="decimal"
                aria-label={t("topUpSelect")}
              />
            ) : (
              <button type="button" style={s.amountValue} onClick={startEdit}>
                {formatUsd(amount)}
              </button>
            )}
            <div style={s.amountHint}>{t("topUpLimit")}</div>
            <div style={s.chipRow}>
              {PRESETS.map((usd) => {
                const on = usd === amount;
                return (
                  <button
                    key={usd}
                    type="button"
                    onClick={() => {
                      setAmount(usd);
                      setEditing(false);
                    }}
                    style={{ ...s.chip, ...(on ? s.chipOn : s.chipOff) }}
                  >
                    {formatUsd(usd)}
                  </button>
                );
              })}
            </div>
          </div>
        </Screen>
      </div>

      <div style={s.payBar}>
        <button style={s.payBtn} onClick={onPay} disabled={paying}>
          {t("topUpPay")} · {formatUsd(amount)}
        </button>
      </div>
    </div>
  );
}

const card: CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--line)",
  borderRadius: "var(--r-xl)",
};

const s: Record<string, CSSProperties> = {
  page: {
    display: "flex",
    flexDirection: "column",
    height: "100dvh",
    maxHeight: "100dvh",
    width: "100%",
    maxWidth: "var(--maxw)",
    margin: "0 auto",
    background: "var(--bg)",
    color: "var(--text)",
    fontFamily: "var(--font)",
    overflow: "hidden",
    boxSizing: "border-box",
  },
  scroll: {
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    overflowX: "hidden",
    WebkitOverflowScrolling: "touch",
    overscrollBehavior: "contain",
  },
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

  amountCard: {
    position: "relative",
    overflow: "hidden",
    ...card,
    padding: "22px 18px 18px",
    textAlign: "center",
  },
  amountGlow: {
    position: "absolute",
    top: -60,
    right: -40,
    width: 180,
    height: 180,
    borderRadius: "50%",
    background: "radial-gradient(circle, rgba(255,138,61,.22), transparent 70%)",
    pointerEvents: "none",
  },
  amountLabel: {
    position: "relative",
    fontSize: "var(--fs-sm)",
    color: "var(--text-dim)",
    textTransform: "uppercase",
    letterSpacing: ".6px",
    fontWeight: 700,
    marginBottom: 10,
  },
  amountValue: {
    position: "relative",
    display: "block",
    width: "100%",
    border: "none",
    background: "transparent",
    color: "var(--text)",
    fontSize: 42,
    fontWeight: 700,
    letterSpacing: "-1.5px",
    marginBottom: 6,
    cursor: "pointer",
    padding: 0,
  },
  amountInput: {
    position: "relative",
    display: "block",
    width: "100%",
    border: "none",
    background: "transparent",
    color: "var(--text)",
    fontSize: 42,
    fontWeight: 700,
    letterSpacing: "-1.5px",
    marginBottom: 6,
    textAlign: "center",
    outline: "none",
    padding: 0,
  },
  amountHint: {
    position: "relative",
    fontSize: "var(--fs-sm)",
    color: "var(--text-dim)",
    marginBottom: 22,
  },
  chipRow: {
    position: "relative",
    display: "flex",
    gap: 8,
    overflowX: "auto",
    paddingBottom: 2,
    scrollbarWidth: "none",
    WebkitOverflowScrolling: "touch",
  },
  chip: {
    flex: "0 0 auto",
    padding: "11px 16px",
    borderRadius: "var(--r-pill)",
    border: "1.5px solid var(--line)",
    fontSize: "var(--fs-md)",
    fontWeight: 700,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  chipOff: {
    background: "var(--surface-2)",
    color: "var(--text-soft)",
  },
  chipOn: {
    background: "var(--accent-tint)",
    borderColor: "var(--accent)",
    color: "var(--accent-soft)",
  },

  payBar: {
    flexShrink: 0,
    background: "var(--bg)",
    borderTop: "1px solid var(--line)",
    padding: "12px 16px",
    paddingBottom: "calc(12px + env(safe-area-inset-bottom, 0px))",
  },
  payBtn: {
    width: "100%",
    padding: 16,
    border: "none",
    borderRadius: "var(--r-lg)",
    cursor: "pointer",
    background: "linear-gradient(135deg,var(--accent),var(--accent-2))",
    color: "var(--accent-ink)",
    fontSize: "var(--fs-lg)",
    fontWeight: 700,
  },
};
