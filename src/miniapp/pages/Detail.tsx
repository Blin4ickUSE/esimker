import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, Clock, ShieldX, Wifi, Zap } from "lucide-react";
import {
  useI18n,
  formatUsd,
  useAccount,
  paths,
  Flag,
  preloadFlags,
  type StringKey,
} from "../components/i18n";
import { blockedInRu, codeOf, displayName, plansFor, type Plan, type Volume } from "@assets/catalog";
import { CountryNotices } from "../components/CountryNotices";
import { gbLabel } from "@assets/volume";

type PlanKind = "regular" | "unlimited";

const volNum = (g: Volume): number => (g === "Безлимит" ? Infinity : g);

const planKey = (p: Plan) => `${p.gb}-${p.days}`;

const sortPlans = (list: Plan[]) =>
  [...list].sort((a, b) => volNum(a.gb) - volNum(b.gb) || a.days - b.days);

function PlanKindSwitch({
  kind,
  onKind,
  hasRegular,
  hasUnlimited,
  t,
  lang,
}: {
  kind: PlanKind;
  onKind: (k: PlanKind) => void;
  hasRegular: boolean;
  hasUnlimited: boolean;
  t: (k: StringKey) => string;
  lang: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const regularRef = useRef<HTMLButtonElement>(null);
  const unlimitedRef = useRef<HTMLButtonElement>(null);
  const [pill, setPill] = useState({ left: 0, width: 0 });

  const syncPill = () => {
    const track = trackRef.current;
    const btn =
      hasRegular && hasUnlimited
        ? kind === "regular"
          ? regularRef.current
          : unlimitedRef.current
        : hasRegular
          ? regularRef.current
          : unlimitedRef.current;
    if (!track || !btn) return;
    const tr = track.getBoundingClientRect();
    const br = btn.getBoundingClientRect();
    setPill({ left: br.left - tr.left, width: br.width });
  };

  useLayoutEffect(() => {
    syncPill();
  }, [kind, hasRegular, hasUnlimited, lang]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const ro = new ResizeObserver(syncPill);
    ro.observe(track);
    return () => ro.disconnect();
  }, [kind, hasRegular, hasUnlimited, lang]);

  return (
    <div ref={trackRef} className="plan-kind-track" style={{ marginBottom: 16 }}>
      {pill.width > 0 && (
        <div
          className="plan-kind-pill"
          style={{ left: pill.left, width: pill.width, height: "calc(100% - 8px)" }}
        />
      )}
      {hasRegular && (
        <button
          ref={regularRef}
          type="button"
          className={`plan-kind-btn${kind === "regular" ? " on" : ""}`}
          onClick={() => onKind("regular")}
        >
          {t("planRegular")}
        </button>
      )}
      {hasUnlimited && (
        <button
          ref={unlimitedRef}
          type="button"
          className={`plan-kind-btn${kind === "unlimited" || !hasRegular ? " on" : ""}`}
          onClick={() => onKind("unlimited")}
        >
          {t("planUnlimited")}
        </button>
      )}
    </div>
  );
}

export default function Detail({ country }: { country: string }) {
  const navigate = useNavigate();
  const { t, lang } = useI18n();
  const { buy, touchCountry, balanceUsd, createPaymentIntent, authenticated, requireAuth } = useAccount();

  useEffect(() => {
    if (authenticated) touchCountry(country);
    preloadFlags([codeOf(country)]);
  }, [country, touchCountry, authenticated]);

  const { regular, unlimited } = useMemo(() => {
    const all = plansFor(country);
    return {
      regular: sortPlans(all.filter((p) => p.gb !== "Безлимит")),
      unlimited: sortPlans(all.filter((p) => p.gb === "Безлимит")),
    };
  }, [country]);

  const hasRegular = regular.length > 0;
  const hasUnlimited = unlimited.length > 0;

  const [kind, setKind] = useState<PlanKind>(() => (hasRegular ? "regular" : "unlimited"));
  useEffect(() => {
    setKind(hasRegular ? "regular" : "unlimited");
    setSelected(0);
  }, [country, hasRegular]);

  const plans = kind === "regular" ? regular : unlimited;
  const [selected, setSelected] = useState(0);
  useEffect(() => setSelected(0), [kind, country]);
  const plan = plans[Math.min(selected, plans.length - 1)];

  const [paying, setPaying] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const executePurchase = async () => {
    if (!plan || paying) return;
    setConfirmOpen(false);
    if (balanceUsd >= plan.usd) {
      setPaying(true);
      try {
        const esim = await buy(plan);
        if (esim) navigate(paths.esim(esim.id));
      } finally {
        setPaying(false);
      }
      return;
    }
    setPaying(true);
    try {
      const intent = await createPaymentIntent({
        kind: "purchase",
        country_code: plan.code,
        gb: plan.gb,
        days: plan.days,
      });
      navigate(paths.payment(intent.id));
    } finally {
      setPaying(false);
    }
  };

  const onPay = () => {
    if (!plan || paying) return;
    requireAuth(() => setConfirmOpen(true));
  };

  const planLabel = (p: Plan) =>
    kind === "unlimited"
      ? `${p.days} ${t("days")}`
      : `${gbLabel(p.gb, lang)} · ${p.days} ${t("days")}`;

  if (lang === "ru" && blockedInRu(country)) {
    return (
      <div style={s.page}>
        <div style={s.scroll}>
          <div style={s.head}>
            <button style={s.back} onClick={() => navigate(paths.buy)} aria-label={t("back")}>
              <ChevronLeft size={20} />
            </button>
            <Flag code={codeOf(country)} size={36} />
            <div>
              <div style={s.title}>{displayName(country, lang)}</div>
              <div style={s.sub}>{t("esimOnly")}</div>
            </div>
          </div>
          <div style={s.blocked}>
            <div style={s.blockedIcon}>
              <ShieldX size={28} />
            </div>
            <div style={s.blockedTitle}>{t("geoBlockedTitle")}</div>
            <div style={s.blockedBody}>{t("geoBlockedBody")}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={s.page}>
      <div style={s.scroll}>
        <div style={s.head}>
          <button style={s.back} onClick={() => navigate(paths.buy)} aria-label={t("back")}>
            <ChevronLeft size={20} />
          </button>
          <Flag code={codeOf(country)} size={36} />
          <div>
            <div style={s.title}>{displayName(country, lang)}</div>
            <div style={s.sub}>{t("esimOnly")}</div>
          </div>
        </div>

        <div style={s.infoCard}>
          <InfoRow icon={<Wifi size={15} />} text={t("onlyInternet")} />
          <InfoRow icon={<Clock size={15} />} text={t("activation180")} />
          <InfoRow icon={<Zap size={15} />} text={t("instant")} />
        </div>

        <CountryNotices country={country} />

        {(hasRegular || hasUnlimited) && (
          <PlanKindSwitch
            kind={kind}
            onKind={setKind}
            hasRegular={hasRegular}
            hasUnlimited={hasUnlimited}
            t={t}
            lang={lang}
          />
        )}

        <div style={{ ...s.label, marginBottom: 12 }}>{t("choosePlan")}</div>
        <div key={kind} className="plan-list-in" style={s.planList}>
          {plans.map((p, i) => {
            const on = i === selected;
            return (
              <button
                key={planKey(p)}
                onClick={() => setSelected(i)}
                style={{ ...s.planRow, ...(on ? s.planOn : s.planOff) }}
              >
                <div style={{ ...s.radio, ...(on ? s.radioOn : null) }} />
                <span style={s.planNum}>{planLabel(p)}</span>
                <div style={{ flex: 1, minWidth: 8 }} />
                <PlanPrice usd={p.usd} />
              </button>
            );
          })}
        </div>
      </div>

      <div style={s.payBar}>
        <button style={s.payBtn} onClick={onPay} disabled={!plan || paying}>
          <span style={s.payText}>
            {paying
              ? t("payLoading")
              : `${t("pay")}${plan ? ` · ${formatUsd(plan.usd)}` : ""}`}
          </span>
        </button>
      </div>

      {confirmOpen && plan && (
        <ConfirmPurchaseModal
          country={country}
          planLabel={planLabel(plan)}
          price={plan.usd}
          fromBalance={balanceUsd >= plan.usd}
          paying={paying}
          t={t}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => void executePurchase()}
        />
      )}
    </div>
  );
}

const PRICE_GHOST = "$999.99";

function PlanPrice({ usd }: { usd: number }) {
  return (
    <div style={s.planPriceCol}>
      <div style={s.planPriceFrame}>
        <div style={s.planPrice}>
          <span style={s.planPriceGhost}>{PRICE_GHOST}</span>
        </div>
        <div style={s.planUsd}>
          <span style={s.planPriceGhost}>{PRICE_GHOST}</span>
        </div>
        <div style={s.planPriceOverlay}>{formatUsd(usd)}</div>
      </div>
    </div>
  );
}

function InfoRow({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div style={s.iRow}>
      <span style={s.iIcon}>{icon}</span>
      <span>{text}</span>
    </div>
  );
}

function ConfirmPurchaseModal({
  country,
  planLabel,
  price,
  fromBalance,
  paying,
  t,
  onCancel,
  onConfirm,
}: {
  country: string;
  planLabel: string;
  price: number;
  fromBalance: boolean;
  paying: boolean;
  t: (k: StringKey) => string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div style={s.modalBackdrop} onClick={onCancel}>
      <div style={s.confirmModal} onClick={(e) => e.stopPropagation()}>
        <div style={s.modalTitle}>{t("payConfirmTitle")}</div>
        <div style={s.confirmBody}>
          <div style={s.confirmRow}>
            <span style={s.confirmLabel}>{t("payConfirmCountry")}</span>
            <span style={s.confirmValue}>{country}</span>
          </div>
          <div style={s.confirmRow}>
            <span style={s.confirmLabel}>{t("payConfirmPlan")}</span>
            <span style={s.confirmValue}>{planLabel}</span>
          </div>
          <div style={s.confirmRow}>
            <span style={s.confirmLabel}>{t("payAmount")}</span>
            <span style={s.confirmPrice}>{formatUsd(price)}</span>
          </div>
          <div style={s.confirmHint}>
            {fromBalance ? t("payConfirmFromBalance") : t("payConfirmToPayment")}
          </div>
        </div>
        <div style={s.confirmActions}>
          <button type="button" style={s.confirmCancel} onClick={onCancel} disabled={paying}>
            {t("payConfirmCancel")}
          </button>
          <button type="button" style={s.confirmOk} onClick={onConfirm} disabled={paying}>
            {paying ? t("payLoading") : t("payConfirm")}
          </button>
        </div>
      </div>
    </div>
  );
}

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
    padding: "16px 16px 12px",
    WebkitOverflowScrolling: "touch",
    overscrollBehavior: "contain",
  },
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
  title: { fontSize: "var(--fs-xl)", fontWeight: 700 },
  sub: { fontSize: "var(--fs-sm)", color: "var(--text-dim)", marginTop: 1 },

  infoCard: {
    background: "var(--surface)",
    border: "1px solid var(--line)",
    borderRadius: "var(--r-lg)",
    padding: "14px 16px",
    marginBottom: 20,
    display: "flex",
    flexDirection: "column",
    gap: 11,
  },
  iRow: { display: "flex", alignItems: "center", gap: 11, fontSize: "var(--fs-md)", color: "var(--text-soft)" },
  iIcon: {
    width: 28,
    height: 28,
    borderRadius: "var(--r-sm)",
    background: "var(--chip)",
    display: "grid",
    placeItems: "center",
    color: "var(--accent)",
    flexShrink: 0,
  },

  label: {
    fontSize: "var(--fs-sm)",
    color: "var(--text-dim)",
    textTransform: "uppercase",
    letterSpacing: ".6px",
    fontWeight: 700,
  },

  planList: {
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    gap: 9,
    width: "100%",
  },
  planRow: {
    display: "flex",
    alignItems: "center",
    gap: 13,
    color: "var(--text)",
    border: "1.5px solid var(--line)",
    borderRadius: "var(--r-lg)",
    padding: "14px 15px",
    cursor: "pointer",
    width: "100%",
    alignSelf: "stretch",
    textAlign: "left",
    boxSizing: "border-box",
  },
  planOff: {
    background: "var(--surface-2)",
  },
  planOn: {
    background: "var(--surface)",
    borderColor: "var(--accent)",
    boxShadow: "0 0 0 3px rgba(255,138,61,.10)",
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: "50%",
    border: "2px solid var(--line-strong)",
    flexShrink: 0,
  },
  radioOn: {
    borderColor: "var(--accent)",
    background: "radial-gradient(circle at center,var(--accent) 42%,transparent 46%)",
  },
  planNum: {
    flexShrink: 0,
    fontSize: "var(--fs-lg)",
    fontWeight: 700,
    lineHeight: 1.3,
    whiteSpace: "nowrap",
  },
  planPriceCol: {
    flexShrink: 0,
    marginLeft: 12,
    textAlign: "right",
    minWidth: 84,
  },
  planPriceFrame: {
    position: "relative",
  },
  planPriceGhost: { visibility: "hidden" },
  planPriceOverlay: {
    position: "absolute",
    right: 0,
    top: "50%",
    transform: "translateY(-50%)",
    fontSize: "var(--fs-lg)",
    fontWeight: 700,
    whiteSpace: "nowrap",
    lineHeight: 1.25,
  },
  planPrice: {
    fontSize: "var(--fs-lg)",
    fontWeight: 700,
    lineHeight: 1.25,
  },
  planUsd: {
    fontSize: "var(--fs-sm)",
    marginTop: 2,
    lineHeight: 1.25,
    minHeight: "calc(var(--fs-sm) * 1.25)",
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
  payText: {
    display: "block",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
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
  confirmModal: {
    width: "100%",
    maxWidth: "var(--maxw)",
    background: "var(--surface)",
    border: "1px solid var(--line)",
    borderRadius: "var(--r-xl)",
    padding: "18px 16px 16px",
  },
  modalTitle: {
    fontSize: "var(--fs-lg)",
    fontWeight: 700,
    marginBottom: 14,
  },
  confirmBody: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    marginBottom: 16,
  },
  confirmRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: 12,
    fontSize: "var(--fs-md)",
  },
  confirmLabel: { color: "var(--text-dim)" },
  confirmValue: { fontWeight: 600, textAlign: "right" },
  confirmPrice: { fontWeight: 700, fontSize: "var(--fs-lg)" },
  confirmHint: {
    marginTop: 4,
    fontSize: "var(--fs-sm)",
    color: "var(--text-soft)",
    lineHeight: 1.45,
  },
  confirmActions: {
    display: "flex",
    gap: 10,
  },
  confirmCancel: {
    flex: 1,
    padding: 14,
    borderRadius: "var(--r-lg)",
    border: "1px solid var(--line-strong)",
    background: "var(--surface-2)",
    color: "var(--text)",
    fontSize: "var(--fs-md)",
    fontWeight: 600,
    cursor: "pointer",
  },
  confirmOk: {
    flex: 1,
    padding: 14,
    borderRadius: "var(--r-lg)",
    border: "none",
    background: "linear-gradient(135deg,var(--accent),var(--accent-2))",
    color: "var(--accent-ink)",
    fontSize: "var(--fs-md)",
    fontWeight: 700,
    cursor: "pointer",
  },

  blocked: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 14,
    textAlign: "center",
    padding: "48px 20px",
    background: "var(--surface)",
    border: "1px solid var(--line)",
    borderRadius: "var(--r-lg)",
  },
  blockedIcon: {
    width: 64,
    height: 64,
    borderRadius: "50%",
    background: "var(--chip)",
    color: "var(--text-dim)",
    display: "grid",
    placeItems: "center",
  },
  blockedTitle: { fontSize: "var(--fs-xl)", fontWeight: 700 },
  blockedBody: {
    fontSize: "var(--fs-md)",
    color: "var(--text-soft)",
    lineHeight: 1.5,
    maxWidth: 320,
  },
};
