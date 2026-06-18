import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import sbpImg from "@assets/img/sbp.png";
import cardRuImg from "@assets/img/card_ru.png";
import cardImg from "@assets/img/card.png";
import cryptobotImg from "@assets/img/cryptobot.png";
import {
  useI18n,
  formatUsd,
  paths,
  useAccount,
  type PaymentIntentView,
} from "../components/i18n";

type Step = "methods" | "crypto";
type MethodId = "sbp" | "card_ru" | "card_intl" | "crypto" | "cryptobot";
type CryptoId = "ton_usdt" | "ton_gram" | "trc20_usdt" | "trc20_trx";

function MethodRow({
  icon,
  label,
  onClick,
  chevron = true,
  disabled = false,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  chevron?: boolean;
  disabled?: boolean;
}) {
  return (
    <button type="button" style={{ ...s.methodRow, ...(disabled ? s.rowDisabled : null) }} onClick={onClick} disabled={disabled}>
      <span style={s.methodIcon}>{icon}</span>
      <span style={s.methodLabel}>{label}</span>
      {chevron && <ChevronRight size={18} color="var(--text-dim)" />}
    </button>
  );
}

function CoinRow({ label, onClick, disabled = false }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" style={{ ...s.coinRow, ...(disabled ? s.rowDisabled : null) }} onClick={onClick} disabled={disabled}>
      <span style={s.coinLabel}>{label}</span>
      <ChevronRight size={16} color="var(--text-dim)" />
    </button>
  );
}

const PLATEGA_METHODS = new Set<MethodId>(["sbp", "card_ru", "card_intl"]);

export default function Payment() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { t } = useI18n();
  const { getPaymentIntent, checkoutPayment, completePayment, refresh } = useAccount();
  const [step, setStep] = useState<Step>("methods");
  const [busy, setBusy] = useState(false);
  const [intent, setIntent] = useState<PaymentIntentView | null>(null);
  const [loadError, setLoadError] = useState(false);

  const paymentId = params.get("id")?.trim() ?? "";
  const paidReturn = params.get("paid");

  useEffect(() => {
    if (!paymentId || paidReturn !== "1") return;
    let cancelled = false;
    let attempts = 0;
    const poll = async () => {
      attempts += 1;
      try {
        const data = await getPaymentIntent(paymentId);
        if (cancelled) return;
        setIntent(data);
        if (data.status === "completed") {
          await refresh();
          if (data.kind === "topup") navigate(paths.home, { replace: true });
          else navigate(paths.myEsims, { replace: true });
        } else if (attempts < 30) {
          window.setTimeout(poll, 2000);
        }
      } catch {
        if (attempts < 30 && !cancelled) window.setTimeout(poll, 2000);
      }
    };
    void poll();
    return () => {
      cancelled = true;
    };
  }, [paymentId, paidReturn, getPaymentIntent, refresh, navigate]);

  useEffect(() => {
    if (!paymentId) {
      setLoadError(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await getPaymentIntent(paymentId);
        if (!cancelled) {
          setIntent(data);
          setLoadError(data.status !== "pending");
        }
      } catch {
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [paymentId, getPaymentIntent]);

  const amount = intent?.amountUsd ?? 0;
  const valid = intent != null && intent.status === "pending" && amount > 0;

  const goBack = () => {
    if (step === "crypto") {
      setStep("methods");
      return;
    }
    if (intent?.kind === "topup") navigate(paths.replenishment);
    else if (intent?.plan?.countryCode) navigate(paths.buyRegion(intent.plan.countryCode));
    else navigate(paths.home);
  };

  const complete = async (method: MethodId | CryptoId) => {
    if (!valid || busy || !intent) return;
    setBusy(true);
    try {
      const payment_provider = method;
      const payment_method =
        method.startsWith("ton_") || method.startsWith("trc20_") ? "crypto" : method;

      if (PLATEGA_METHODS.has(method as MethodId)) {
        const { redirectUrl } = await checkoutPayment(intent.id, {
          payment_method,
          payment_provider,
        });
        window.location.href = redirectUrl;
        return;
      }

      const esim = await completePayment(intent.id, { payment_method, payment_provider });
      if (intent.kind === "topup") {
        navigate(paths.home);
        return;
      }
      if (esim) navigate(paths.esim(esim.id));
      else navigate(paths.myEsims);
    } finally {
      setBusy(false);
    }
  };

  if (!valid || loadError) {
    return (
      <div style={s.page}>
        <div style={s.scroll}>
          <div style={s.head}>
            <button type="button" style={s.back} onClick={() => navigate(paths.home)} aria-label={t("back")}>
              <ChevronLeft size={20} />
            </button>
            <div style={s.title}>{t("payTitle")}</div>
          </div>
          <div style={s.missing}>{t("payInvalid")}</div>
        </div>
      </div>
    );
  }

  return (
    <div style={s.page}>
      <div style={s.scroll}>
        <div style={s.head}>
          <button type="button" style={s.back} onClick={goBack} aria-label={t("back")}>
            <ChevronLeft size={20} />
          </button>
          <div style={s.title}>{step === "crypto" ? t("payCrypto") : t("payTitle")}</div>
        </div>

        <div style={s.amountCard}>
          <div style={s.amountGlow} />
          <div style={s.amountLabel}>{t("payAmount")}</div>
          <div style={s.amountValue}>{formatUsd(amount)}</div>
        </div>

        {busy && <div style={s.busyBanner}>{t("payLoading")}</div>}

        {step === "methods" ? (
          <div style={s.list}>
            <MethodRow
              icon={<img src={sbpImg} alt="" style={s.img} />}
              label={t("paySbp")}
              onClick={() => complete("sbp")}
              chevron={false}
              disabled={busy}
            />
            <MethodRow
              icon={<img src={cardRuImg} alt="" style={s.img} />}
              label={t("payCardRu")}
              onClick={() => complete("card_ru")}
              chevron={false}
              disabled={busy}
            />
            <MethodRow
              icon={<img src={cardImg} alt="" style={s.img} />}
              label={t("payCardIntl")}
              onClick={() => complete("card_intl")}
              chevron={false}
              disabled={busy}
            />
            <MethodRow
              icon={<span style={s.cryptoIcon}>₿</span>}
              label={t("payCrypto")}
              onClick={() => setStep("crypto")}
              disabled={busy}
            />
            <MethodRow
              icon={<img src={cryptobotImg} alt="" style={s.img} />}
              label={t("payCryptobot")}
              onClick={() => complete("cryptobot")}
              chevron={false}
              disabled={busy}
            />
          </div>
        ) : (
          <div style={s.list}>
            <div style={s.netLabel}>{t("payCryptoTon")}</div>
            <CoinRow label="USDT" onClick={() => complete("ton_usdt")} disabled={busy} />
            <CoinRow label="GRAM" onClick={() => complete("ton_gram")} disabled={busy} />
            <div style={s.divider} />
            <div style={s.netLabel}>{t("payCryptoTrc20")}</div>
            <CoinRow label="USDT" onClick={() => complete("trc20_usdt")} disabled={busy} />
            <CoinRow label="TRX" onClick={() => complete("trc20_trx")} disabled={busy} />
          </div>
        )}
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
    padding: "16px 16px 32px",
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
    padding: "22px 18px",
    marginBottom: 18,
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
    fontSize: 42,
    fontWeight: 700,
    letterSpacing: "-1.5px",
  },

  list: {
    display: "flex",
    flexDirection: "column",
    gap: 9,
  },
  methodRow: {
    display: "flex",
    alignItems: "center",
    gap: 13,
    width: "100%",
    color: "var(--text)",
    background: "var(--surface)",
    border: "1px solid var(--line)",
    borderRadius: "var(--r-lg)",
    padding: "12px 15px",
    cursor: "pointer",
    textAlign: "left",
  },
  methodIcon: {
    width: 40,
    height: 40,
    borderRadius: "var(--r-md)",
    background: "var(--chip)",
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    overflow: "hidden",
  },
  methodLabel: { flex: 1, fontSize: "var(--fs-lg)", fontWeight: 600 },
  img: { width: 32, height: 32, objectFit: "contain" },
  cryptoIcon: {
    fontSize: 20,
    fontWeight: 700,
    color: "var(--accent)",
  },

  netLabel: {
    fontSize: "var(--fs-xs)",
    color: "var(--text-dim)",
    textTransform: "uppercase",
    letterSpacing: ".6px",
    fontWeight: 700,
    padding: "4px 2px 2px",
  },
  divider: { height: 1, background: "var(--line)", margin: "4px 0" },
  coinRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    color: "var(--text)",
    background: "var(--surface)",
    border: "1px solid var(--line)",
    borderRadius: "var(--r-lg)",
    padding: "12px 15px",
    cursor: "pointer",
    textAlign: "left",
  },
  coinLabel: { fontSize: "var(--fs-lg)", fontWeight: 600 },

  busyBanner: {
    textAlign: "center",
    padding: "10px 12px",
    marginBottom: 12,
    borderRadius: "var(--r-lg)",
    background: "var(--chip)",
    color: "var(--accent)",
    fontSize: "var(--fs-md)",
    fontWeight: 600,
  },
  rowDisabled: {
    opacity: 0.55,
    cursor: "default",
  },

  missing: {
    textAlign: "center",
    color: "var(--text-dim)",
    padding: "48px 16px",
    fontSize: "var(--fs-md)",
  },
};
