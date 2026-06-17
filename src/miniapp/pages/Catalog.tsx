import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, Flame, Search } from "lucide-react";
import {
  useI18n,
  formatUsd,
  paths,
  Flag,
  Screen,
  SectionLabel,
  preloadFlags,
  useAccount,
} from "../components/i18n";
import {
  codeOf,
  displayName,
  blockedInRu,
  isCountryProduct,
  minUsd,
  searchCountries,
} from "@assets/catalog";

export default function Catalog() {
  const navigate = useNavigate();
  const { t, lang } = useI18n();
  const { touchCountry, authenticated } = useAccount();
  const [query, setQuery] = useState("");
  const [popularRaw, setPopularRaw] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/catalog/popular");
        const data = (await res.json()) as { countries?: string[] };
        if (!cancelled) setPopularRaw(data.countries ?? []);
      } catch {
        if (!cancelled) setPopularRaw([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const list = useMemo(() => searchCountries(query, lang), [query, lang]);
  const popular = useMemo(
    () =>
      popularRaw.filter(
        (name) => isCountryProduct(name) && !(lang === "ru" && blockedInRu(name)),
      ),
    [popularRaw, lang],
  );

  const open = (country: string) => {
    if (authenticated) touchCountry(country);
    navigate(paths.buyRegion(codeOf(country)));
  };

  useEffect(() => {
    preloadFlags(popular.map((n) => codeOf(n)));
  }, [popular]);

  useEffect(() => {
    preloadFlags(list.slice(0, 24).map((n) => codeOf(n)));
  }, [list]);

  const price = (name: string) => formatUsd(minUsd(name));

  return (
    <Screen>
      <div style={s.head}>
        <button style={s.back} onClick={() => navigate(paths.home)} aria-label={t("back")}>
          <ChevronLeft size={20} />
        </button>
        <div style={s.title}>{t("buyEsim")}</div>
      </div>

      <div style={s.searchWrap}>
        <Search size={17} color="var(--text-dim)" />
        <input
          style={s.search}
          placeholder={t("searchPlaceholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {!query && popular.length > 0 && (
        <>
          <SectionLabel>
            <Flame size={13} color="var(--accent)" /> {t("popular")}
          </SectionLabel>
          <div style={s.popRow}>
            {popular.map((n) => (
              <button key={n} style={s.popCard} onClick={() => open(n)}>
                <Flag code={codeOf(n)} size={40} />
                <div style={s.popName}>{displayName(n, lang)}</div>
                <div style={s.popFrom}>
                  {t("from")} {price(n)}
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      <SectionLabel>{query ? t("results") : t("allCountries")}</SectionLabel>
      <div style={s.list}>
        {list.map((n) => (
          <button key={n} style={s.row} onClick={() => open(n)}>
            <Flag code={codeOf(n)} />
            <div style={{ flex: 1, textAlign: "left" }}>
              <div style={s.rowName}>{displayName(n, lang)}</div>
              <div style={s.rowFrom}>
                {t("from")} {price(n)}
              </div>
            </div>
            <ChevronRight size={18} color="var(--text-dim)" />
          </button>
        ))}
        {list.length === 0 && <div style={s.empty}>{t("notFound")}</div>}
      </div>
    </Screen>
  );
}

const s: Record<string, CSSProperties> = {
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

  searchWrap: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    background: "var(--surface)",
    border: "1px solid var(--line-strong)",
    borderRadius: 13,
    padding: "12px 14px",
    marginBottom: 18,
  },
  search: {
    flex: 1,
    background: "transparent",
    border: "none",
    outline: "none",
    color: "var(--text)",
    fontSize: "var(--fs-base)",
  },

  popRow: {
    display: "flex",
    gap: 10,
    overflowX: "auto",
    paddingBottom: 6,
    marginBottom: 20,
    scrollbarWidth: "none",
  },
  popCard: {
    flex: "0 0 auto",
    width: 96,
    color: "var(--text)",
    background: "var(--surface)",
    border: "1px solid var(--line)",
    borderRadius: "var(--r-lg)",
    padding: "13px 10px",
    cursor: "pointer",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 7,
  },
  popName: {
    fontSize: "var(--fs-sm)",
    fontWeight: 700,
    textAlign: "center",
    lineHeight: 1.2,
  },
  popFrom: { fontSize: "var(--fs-xs)", color: "var(--text-dim)" },

  list: { display: "flex", flexDirection: "column", gap: 9, marginBottom: 8 },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 13,
    color: "var(--text)",
    background: "var(--surface)",
    border: "1px solid var(--line)",
    borderRadius: "var(--r-lg)",
    padding: "12px 15px",
    cursor: "pointer",
    width: "100%",
  },
  rowName: { fontSize: "var(--fs-lg)", fontWeight: 600 },
  rowFrom: { fontSize: "var(--fs-sm)", color: "var(--text-dim)", marginTop: 2 },
  empty: { textAlign: "center", color: "var(--text-dim)", padding: "40px 0" },
};
