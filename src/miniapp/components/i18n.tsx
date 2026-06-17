import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Globe2, Moon, Sun } from "lucide-react";
import type { Lang, Plan } from "@assets/catalog";
import ruText from "@assets/i18n/ru.txt?raw";
import enText from "@assets/i18n/en.txt?raw";
import { migrateEsim } from "../pages/EsimDetail";
import { TelegramAuthModal, type TelegramLoginUser } from "./TelegramAuth";

const isRegion = (code: string): boolean => code.length !== 2;

export const paths = {
  home: "/",
  buy: "/buy",
  buyRegion: (code: string) => `/buy?region=${encodeURIComponent(code.toUpperCase())}`,
  myEsims: "/myesims",
  referral: "/referral",
  replenishment: "/replenishment",
  settings: "/settings",
  esim: (id: string) => `/esim/${encodeURIComponent(id)}`,
  payment: (id: string) => `/payment?id=${encodeURIComponent(id)}`,
} as const;

export type StringKey =
  | "brand"
  | "balance"
  | "topUp"
  | "topUpSelect"
  | "topUpPay"
  | "topUpLimit"
  | "buyEsim"
  | "buyEsimSub"
  | "myEsims"
  | "referral"
  | "referralSub"
  | "referralEarned"
  | "referralFriend"
  | "referralFriendDesc"
  | "referralYou"
  | "referralYouDesc"
  | "referralLink"
  | "referralCopy"
  | "referralCopied"
  | "promo"
  | "promoPlaceholder"
  | "activate"
  | "promoOk"
  | "promoBad"
  | "promoUsed"
  | "searchPlaceholder"
  | "popular"
  | "regions"
  | "worldCountries"
  | "allCountries"
  | "results"
  | "notFound"
  | "from"
  | "back"
  | "esimOnly"
  | "onlyInternet"
  | "activation180"
  | "instant"
  | "dataVolume"
  | "choosePlan"
  | "planRegular"
  | "planUnlimited"
  | "validity"
  | "days"
  | "pay"
  | "unlimited"
  | "paidFromBalance"
  | "paidByCard"
  | "myEsimsEmpty"
  | "myEsimsEmptyCta"
  | "active"
  | "expired"
  | "geoBlockedTitle"
  | "geoBlockedBody"
  | "settings"
  | "settingsEmail"
  | "settingsEmailNone"
  | "settingsEmailChange"
  | "settingsEmailUnlink"
  | "settingsEmailPlaceholder"
  | "settingsEmailSendCode"
  | "settingsEmailCodePlaceholder"
  | "settingsEmailConfirm"
  | "settingsEmailSent"
  | "settingsEmailOk"
  | "settingsEmailInvalid"
  | "settingsEmailUnlinked"
  | "settingsNotifications"
  | "settingsNotifyNews"
  | "settingsNotifyMarketing"
  | "settingsNotifyTraffic"
  | "settingsLegal"
  | "settingsTerms"
  | "settingsPrivacy"
  | "settingsSupport"
  | "esimStatusInactive"
  | "esimStatusLimit"
  | "esimIccid"
  | "esimPurchased"
  | "esimDataLeft"
  | "esimExpiresIn"
  | "esimAfterInstall"
  | "esimHours"
  | "esimInstallQr"
  | "esimManualInstall"
  | "esimSmdp"
  | "esimActivationCode"
  | "esimNotes"
  | "esimInstallIphone"
  | "esimInstallAndroid"
  | "esimCopy"
  | "esimNotFound"
  | "esimNoteWifi"
  | "esimNoteCountry"
  | "esimNoteRoaming"
  | "esimNoteStatusDelay"
  | "esimNoteTrafficDelay"
  | "esimNoteNoTransfer"
  | "payTitle"
  | "payAmount"
  | "paySbp"
  | "payCardRu"
  | "payCardIntl"
  | "payCrypto"
  | "payCryptobot"
  | "payCryptoTon"
  | "payCryptoTrc20"
  | "payInvalid"
  | "authTitle"
  | "authSub"
  | "authOpenBot"
  | "authBotMissing"
  | "authLoading";

type Dict = Partial<Record<StringKey, string>>;

function parse(text: string): Dict {
  const dict: Dict = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key) dict[key as StringKey] = value;
  }
  return dict;
}

const TABLES: Record<Lang, Dict> = {
  ru: parse(ruText),
  en: parse(enText),
};

interface I18nCtx {
  lang: Lang;
  setLang: (lang: Lang) => void;
  toggle: () => void;
  t: (key: StringKey) => string;
}

const I18nCtx = createContext<I18nCtx | null>(null);
const LANG_KEY = "esimker.lang";

function readLang(): Lang {
  const saved = localStorage.getItem(LANG_KEY);
  return saved === "en" ? "en" : "ru";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(readLang);

  useEffect(() => {
    localStorage.setItem(LANG_KEY, lang);
    document.documentElement.lang = lang;
  }, [lang]);

  const value = useMemo<I18nCtx>(
    () => ({
      lang,
      setLang,
      toggle: () => setLang((l) => (l === "ru" ? "en" : "ru")),
      t: (key) => TABLES[lang][key] ?? key,
    }),
    [lang],
  );

  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>;
}

export function useI18n(): I18nCtx {
  const ctx = useContext(I18nCtx);
  if (!ctx) throw new Error("useI18n must be used inside <I18nProvider>");
  return ctx;
}

export const formatUsd = (usd: number): string => `$${usd.toFixed(2)}`;

/** @deprecated use formatUsd */
export const formatMoney = (usd: number): string => formatUsd(usd);

type ThemeName = "dark" | "light";
type PaymentMethod = "balance" | "card";
type Volume = Plan["gb"];

export type EsimStatus = "inactive" | "active" | "expired" | "limit";

export interface Esim {
  id: string;
  name: string;
  code: string;
  gb: Volume;
  days: number;
  usd: number;
  purchasedAt: number;
  status: EsimStatus;
  iccid: string;
  smdpAddress: string;
  activationCode: string;
  dataRemainingGb: number | null;
  activatedAt?: number;
  expiresAt?: number;
}

export interface Order {
  id: string;
  name: string;
  code: string;
  gb: Volume;
  days: number;
  usd: number;
  method: PaymentMethod;
  createdAt: number;
}

const dark = {
  "--bg": "#0c0d10",
  "--surface": "#15171c",
  "--surface-2": "#1b1d23",
  "--line": "#1e2027",
  "--line-strong": "#23262f",
  "--chip": "#23262f",
  "--text": "#eef0f4",
  "--text-soft": "#c4c8d2",
  "--text-dim": "#6b7180",
  "--accent": "#ff8a3d",
  "--accent-2": "#ff6a2c",
  "--accent-soft": "#ffb37e",
  "--accent-tint": "#1c1712",
  "--accent-ink": "#1a0f06",
  "--shadow": "0 6px 20px rgba(255,122,52,.40)",
};

const light: typeof dark = {
  "--bg": "#f4f6f9",
  "--surface": "#ffffff",
  "--surface-2": "#eef1f6",
  "--line": "#e5e8ee",
  "--line-strong": "#d7dbe3",
  "--chip": "#eef1f6",
  "--text": "#14161b",
  "--text-soft": "#3b414e",
  "--text-dim": "#8a8f9c",
  "--accent": "#ef6c1a",
  "--accent-2": "#e05a10",
  "--accent-soft": "#c2560f",
  "--accent-tint": "#fff1e8",
  "--accent-ink": "#ffffff",
  "--shadow": "0 6px 18px rgba(239,108,26,.28)",
};

const base = {
  "--r-sm": "8px",
  "--r-md": "11px",
  "--r-lg": "14px",
  "--r-xl": "18px",
  "--r-pill": "20px",
  "--fs-xs": "11px",
  "--fs-sm": "12px",
  "--fs-md": "13px",
  "--fs-base": "15px",
  "--fs-lg": "16px",
  "--fs-xl": "20px",
  "--fs-2xl": "25px",
  "--maxw": "440px",
  "--font":
    "'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  "--lh": "1.45",
  "--lh-tight": "1.2",
};

const block = (sel: string, vars: Record<string, string>) =>
  `${sel}{${Object.entries(vars)
    .map(([k, v]) => `${k}:${v}`)
    .join(";")}}`;

const tokenCss = [
  block(":root", base),
  block(':root[data-theme="dark"]', dark),
  block(':root[data-theme="light"]', light),
  `html,body{margin:0;padding:0;font-family:var(--font);font-size:16px;line-height:var(--lh);-webkit-font-smoothing:antialiased}
html{height:100%}
body{background:var(--bg);color:var(--text);min-height:100%}
#root{min-height:100%}
button,input,select,textarea{font-family:inherit;font-size:inherit}
@keyframes pageIn{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
.page-transition{animation:pageIn .38s cubic-bezier(.22,1,.36,1) both}
@keyframes fadeUp{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
.home-in{animation:fadeUp .55s cubic-bezier(.22,1,.36,1) both}
.home-in-1{animation-delay:.05s}.home-in-2{animation-delay:.11s}.home-in-3{animation-delay:.17s}
.home-in-4{animation-delay:.23s}.home-in-5{animation-delay:.29s}.home-in-6{animation-delay:.35s}.home-in-7{animation-delay:.41s}
.lang-track{position:relative;display:flex;gap:3px;padding:3px;border-radius:var(--r-pill);background:var(--surface);border:1px solid var(--line-strong);touch-action:none;user-select:none}
.lang-pill{position:absolute;top:3px;left:3px;width:34px;height:28px;border-radius:var(--r-pill);background:var(--chip);box-shadow:0 1px 4px rgba(0,0,0,.12);pointer-events:none;z-index:0}
.lang-pill.snap{transition:left .34s cubic-bezier(.34,1.25,.64,1)}
.lang-btn{width:34px;height:28px;padding:0;border:none;background:transparent;cursor:pointer;display:grid;place-items:center;position:relative;z-index:1}
.lang-flag{width:18px;height:13px;border-radius:3px;object-fit:cover;box-shadow:inset 0 0 0 1px rgba(128,128,128,.18);pointer-events:none}
.theme-btn{position:relative;display:grid;place-items:center;width:34px;height:34px;border-radius:var(--r-pill);background:var(--surface);border:1px solid var(--line-strong);color:var(--text-soft);cursor:pointer;overflow:hidden}
.theme-icons{position:relative;width:16px;height:16px}
.theme-icons svg{position:absolute;inset:0;transition:transform .5s cubic-bezier(.34,1.4,.64,1),opacity .35s ease}
.theme-icons .sun-icon{opacity:1;transform:rotate(0deg) scale(1)}
.theme-icons .moon-icon{opacity:0;transform:rotate(-120deg) scale(.4)}
:root[data-theme="light"] .theme-icons .sun-icon{opacity:0;transform:rotate(120deg) scale(.4)}
:root[data-theme="light"] .theme-icons .moon-icon{opacity:1;transform:rotate(0deg) scale(1)}
.flag-img{display:block;object-fit:cover;border-radius:5px;box-shadow:inset 0 0 0 1px rgba(128,128,128,.18);background:var(--chip)}
.flag-img.loading{opacity:0}
.flag-img.loaded{opacity:1;transition:opacity .25s ease}
.plan-kind-track{position:relative;display:flex;gap:4px;padding:4px;border-radius:var(--r-lg);background:var(--surface-2);border:1px solid var(--line)}
.plan-kind-pill{position:absolute;top:4px;border-radius:var(--r-md);background:var(--surface);box-shadow:0 1px 4px rgba(0,0,0,.08);pointer-events:none;z-index:0;transition:left .34s cubic-bezier(.34,1.25,.64,1),width .34s cubic-bezier(.34,1.25,.64,1)}
.plan-kind-btn{flex:1;min-width:0;position:relative;z-index:1;padding:10px 14px;border:none;border-radius:var(--r-md);background:transparent;color:var(--text-dim);font-size:var(--fs-md);font-weight:700;cursor:pointer;white-space:nowrap}
.plan-kind-btn.on{color:var(--text)}
.plan-list-in{animation:fadeUp .32s cubic-bezier(.22,1,.36,1) both}`,
].join("\n");

interface ThemeCtx {
  theme: ThemeName;
  toggle: () => void;
}

const ThemeCtx = createContext<ThemeCtx | null>(null);
const THEME_KEY = "esimker.theme";

function readTheme(): ThemeName {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "dark" || saved === "light") return saved;
  return "dark";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeName>(readTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  return (
    <ThemeCtx.Provider value={{ theme, toggle: () => setTheme((t) => (t === "dark" ? "light" : "dark")) }}>
      <style>{tokenCss}</style>
      {children}
    </ThemeCtx.Provider>
  );
}

function useTheme(): ThemeCtx {
  const ctx = useContext(ThemeCtx);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}


export interface NotificationPrefs {
  news: boolean;
  marketing: boolean;
  traffic: boolean;
}

export interface ReferralInfo {
  code: string;
  earnedUsd: number;
  referredCount: number;
  link: string;
}

export interface AccountSettings {
  email: string | null;
  emailVerified: boolean;
  notifications: NotificationPrefs;
}

interface CountryStat {
  purchases: number;
  lastAt: number;
}

interface AccountState {
  balanceUsd: number;
  esims: Esim[];
  orders: Order[];
  usedPromos: string[];
  countryStats: Record<string, CountryStat>;
  referral: ReferralInfo;
  settings: AccountSettings;
}

type PromoResult = "ok" | "invalid" | "used";

export interface PaymentOpts {
  payment_method?: string;
  payment_provider?: string;
}

export interface PaymentIntentView {
  id: string;
  kind: "topup" | "purchase";
  amountUsd: number;
  status: string;
  expiresAt: number;
  plan?: {
    name: string;
    countryCode: string;
    gb: Plan["gb"];
    days: number;
    usd: number;
  };
}

interface AccountCtx extends AccountState {
  ready: boolean;
  loading: boolean;
  authenticated: boolean;
  error: string | null;
  botUsername: string;
  authModalOpen: boolean;
  requireAuth: (action?: () => void) => boolean;
  closeAuthModal: () => void;
  buy: (plan: Plan) => Promise<Esim | null>;
  createPaymentIntent: (body: Record<string, unknown>) => Promise<PaymentIntentView>;
  getPaymentIntent: (id: string) => Promise<PaymentIntentView>;
  completePayment: (id: string, opts?: PaymentOpts) => Promise<Esim | null>;
  activatePromo: (code: string) => Promise<PromoResult>;
  touchCountry: (name: string) => void;
  updateSettings: (patch: Partial<AccountSettings>) => Promise<void>;
  confirmEmail: (email: string, code: string) => Promise<void>;
  unlinkEmail: () => Promise<void>;
  refresh: () => Promise<void>;
}

const API_BASE = "/api";
const LOGIN_KEY = "esimker.telegramLogin";
const LOGIN_MAX_AGE_MS = 86_400_000;
const DEFAULT_BOT_USERNAME = "esimker_bot";

function resolveBotUsername(fetched: string | null | undefined): string {
  const fromEnv = import.meta.env.VITE_TELEGRAM_BOT_USERNAME as string | undefined;
  return (fetched || fromEnv || DEFAULT_BOT_USERNAME).trim().replace(/^@/, "");
}

async function fetchBotUsername(): Promise<string> {
  try {
    const res = await fetch(`${API_BASE}/config`);
    if (res.ok) {
      const data = (await res.json()) as { botUsername?: string | null };
      if (data.botUsername?.trim()) return resolveBotUsername(data.botUsername);
    }
  } catch {
    /* API may be offline during local dev */
  }
  return resolveBotUsername(null);
}

function hasWebAppAuth(): boolean {
  return Boolean(window.Telegram?.WebApp?.initData?.trim());
}

function hasTelegramAuth(): boolean {
  return hasWebAppAuth() || Boolean(readStoredLogin());
}

const LEGACY_DEV_KEYS = ["esimker.devBypass", "esimker.devTelegramId"] as const;

function purgeLegacyDevStorage(): void {
  for (const key of LEGACY_DEV_KEYS) {
    localStorage.removeItem(key);
  }
}

function readStoredLogin(): TelegramLoginUser | null {
  try {
    const raw = localStorage.getItem(LOGIN_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as TelegramLoginUser;
    if (!data?.id || !data.hash || !data.auth_date) return null;
    if (Date.now() - data.auth_date * 1000 > LOGIN_MAX_AGE_MS) {
      localStorage.removeItem(LOGIN_KEY);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function normalizeLoginUser(user: TelegramLoginUser): TelegramLoginUser {
  return {
    id: Number(user.id),
    auth_date: Number(user.auth_date),
    hash: String(user.hash),
    ...(user.first_name ? { first_name: String(user.first_name) } : {}),
    ...(user.last_name ? { last_name: String(user.last_name) } : {}),
    ...(user.username ? { username: String(user.username) } : {}),
    ...(user.photo_url ? { photo_url: String(user.photo_url) } : {}),
  };
}

function storeLogin(user: TelegramLoginUser): void {
  localStorage.setItem(LOGIN_KEY, JSON.stringify(normalizeLoginUser(user)));
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData?: string;
        initDataUnsafe?: {
          user?: { id?: number };
          start_param?: string;
        };
        ready?: () => void;
        expand?: () => void;
      };
    };
  }
}

const defaultNotifications = (): NotificationPrefs => ({
  news: true,
  marketing: false,
  traffic: true,
});

const defaultReferral = (): ReferralInfo => ({
  code: "",
  earnedUsd: 0,
  referredCount: 0,
  link: "",
});

const emptyAccount: AccountState = {
  balanceUsd: 0,
  esims: [],
  orders: [],
  usedPromos: [],
  countryStats: {},
  referral: defaultReferral(),
  settings: { email: null, emailVerified: false, notifications: defaultNotifications() },
};

function encodeLoginHeader(login: TelegramLoginUser): string {
  const json = JSON.stringify(login);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `b64:${btoa(binary)}`;
}

function apiHeaders(): HeadersInit {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const initData = window.Telegram?.WebApp?.initData?.trim();
  if (initData) {
    headers["X-Telegram-Init-Data"] = initData;
  } else {
    const login = readStoredLogin();
    if (login) {
      headers["X-Telegram-Login-Data"] = encodeLoginHeader(login);
    }
  }
  return headers;
}

function referralFromUrl(): string | null {
  const ref = new URLSearchParams(window.location.search).get("ref");
  if (ref?.trim()) return ref.trim();
  const startParam = window.Telegram?.WebApp?.initDataUnsafe?.start_param?.trim();
  if (!startParam) return null;
  return startParam.toLowerCase().startsWith("ref_") ? startParam.slice(4) : startParam;
}

function referralLink(code: string): string {
  const base = window.location.origin.replace(/\/$/, "");
  return `${base}/?ref=${code}`;
}

interface ApiAccount {
  balanceUsd: number;
  esims: Esim[];
  orders: Order[];
  usedPromos: string[];
  countryStats: Record<string, CountryStat>;
  referral: ReferralInfo;
  settings: AccountSettings;
  esimId?: string;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { ...apiHeaders(), ...(init?.headers as Record<string, string> | undefined) },
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(typeof data.error === "string" ? data.error : `HTTP ${res.status}`);
  }
  return data;
}

function applyAccount(data: ApiAccount): AccountState {
  const referral = data.referral ?? defaultReferral();
  return {
    balanceUsd: data.balanceUsd ?? 0,
    esims: (data.esims ?? []).map((e) => migrateEsim(e as LegacyEsim)),
    orders: data.orders ?? [],
    usedPromos: data.usedPromos ?? [],
    countryStats: data.countryStats ?? {},
    referral: {
      ...referral,
      link: referral.link?.startsWith("http") ? referral.link : referralLink(referral.code),
    },
    settings: {
      email: data.settings?.email ?? null,
      emailVerified: data.settings?.emailVerified ?? false,
      notifications: { ...defaultNotifications(), ...data.settings?.notifications },
    },
  };
}

function planRef(plan: Plan) {
  return {
    country_code: plan.code,
    gb: plan.gb,
    days: plan.days,
  };
}

const AccountCtx = createContext<AccountCtx | null>(null);

type LegacyEsim = Partial<Esim> & {
  id: string;
  name: string;
  code: string;
  gb: Volume;
  days: number;
  usd: number;
  purchasedAt: number;
  status?: string;
  rub?: number;
};

export function AccountProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AccountState>(emptyAccount);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [botUsername, setBotUsername] = useState(() => resolveBotUsername(null));
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const pendingActionRef = useRef<(() => void) | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const refresh = useCallback(async () => {
    const ref = referralFromUrl();
    const qs = ref ? `?ref=${encodeURIComponent(ref)}` : "";
    const data = await apiFetch<ApiAccount>(`/account${qs}`);
    setState(applyAccount(data));
    setError(null);
    setAuthenticated(true);
    setReady(true);
  }, []);

  const loginWithTelegram = useCallback(
    async (user: TelegramLoginUser) => {
      const login = normalizeLoginUser(user);
      setAuthBusy(true);
      setAuthError(null);
      try {
        storeLogin(login);
        const ref = referralFromUrl();
        const data = await apiFetch<ApiAccount>("/auth/telegram", {
          method: "POST",
          body: JSON.stringify({ ...login, ...(ref ? { ref } : {}) }),
        });
        setState(applyAccount(data));
        setAuthenticated(true);
        setReady(true);
        setError(null);
        setAuthModalOpen(false);
        const pending = pendingActionRef.current;
        pendingActionRef.current = null;
        pending?.();
      } catch (err) {
        localStorage.removeItem(LOGIN_KEY);
        setAuthenticated(false);
        const message = err instanceof Error ? err.message : "auth failed";
        setAuthError(message);
        setError(message);
        setAuthModalOpen(true);
      } finally {
        setAuthBusy(false);
      }
    },
    [],
  );

  const requireAuth = useCallback((action?: () => void): boolean => {
    if (authenticated) {
      action?.();
      return true;
    }
    if (!hasTelegramAuth()) {
      pendingActionRef.current = action ?? null;
      setAuthError(null);
      setAuthModalOpen(true);
      return false;
    }
    pendingActionRef.current = action ?? null;
    void refresh()
      .then(() => {
        const pending = pendingActionRef.current;
        pendingActionRef.current = null;
        pending?.();
      })
      .catch(() => {
        localStorage.removeItem(LOGIN_KEY);
        setAuthenticated(false);
        pendingActionRef.current = action ?? null;
        setAuthModalOpen(true);
      });
    return true;
  }, [authenticated, refresh]);

  const closeAuthModal = useCallback(() => {
    const hadPending = pendingActionRef.current !== null;
    setAuthModalOpen(false);
    pendingActionRef.current = null;
    if (hadPending && !authenticated && window.history.length > 1) {
      window.history.back();
    }
  }, [authenticated]);

  useEffect(() => {
    if (!authModalOpen || botUsername) return;
    let cancelled = false;
    void fetchBotUsername().then((name) => {
      if (!cancelled) setBotUsername(name);
    });
    return () => {
      cancelled = true;
    };
  }, [authModalOpen, botUsername]);

  useEffect(() => {
    purgeLegacyDevStorage();
    window.Telegram?.WebApp?.ready?.();
    window.Telegram?.WebApp?.expand?.();
    let cancelled = false;
    void fetchBotUsername().then((name) => {
      if (!cancelled) setBotUsername(name);
    });
    (async () => {
      if (!hasTelegramAuth()) {
        if (!cancelled) {
          setLoading(false);
          setReady(true);
        }
        return;
      }
      try {
        await refresh();
      } catch (err) {
        if (!cancelled) {
          setAuthenticated(false);
          setError(err instanceof Error ? err.message : "load failed");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const buy = useCallback(async (plan: Plan): Promise<Esim | null> => {
    if (stateRef.current.balanceUsd < plan.usd) return null;
    try {
      const data = await apiFetch<ApiAccount>("/account/purchase/balance", {
        method: "POST",
        body: JSON.stringify(planRef(plan)),
      });
      const next = applyAccount(data);
      setState(next);
      const id = data.esimId ?? next.esims[0]?.id;
      return id ? next.esims.find((e) => e.id === id) ?? next.esims[0] ?? null : null;
    } catch {
      return null;
    }
  }, []);

  const createPaymentIntent = useCallback(async (body: Record<string, unknown>) => {
    return apiFetch<PaymentIntentView>("/payments/intent", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }, []);

  const getPaymentIntent = useCallback(async (id: string) => {
    return apiFetch<PaymentIntentView>(`/payments/intent?id=${encodeURIComponent(id)}`);
  }, []);

  const completePayment = useCallback(async (id: string, opts?: PaymentOpts): Promise<Esim | null> => {
    const data = await apiFetch<ApiAccount>("/payments/complete", {
      method: "POST",
      body: JSON.stringify({
        id,
        payment_method: opts?.payment_method ?? "card",
        payment_provider: opts?.payment_provider,
      }),
    });
    const next = applyAccount(data);
    setState(next);
    const esimId = data.esimId;
    return esimId ? next.esims.find((e) => e.id === esimId) ?? null : null;
  }, []);

  const activatePromo = useCallback(async (code: string): Promise<PromoResult> => {
    const data = await apiFetch<ApiAccount & { result?: PromoResult }>("/account/promo", {
      method: "POST",
      body: JSON.stringify({ code }),
    });
    setState(applyAccount(data));
    return data.result ?? "invalid";
  }, []);

  const touchCountry = useCallback((name: string) => {
    void apiFetch<ApiAccount>("/account/touch-country", {
      method: "POST",
      body: JSON.stringify({ country_name: name }),
    })
      .then((data) => setState(applyAccount(data)))
      .catch(() => undefined);
  }, []);

  const updateSettings = useCallback(async (patch: Partial<AccountSettings>) => {
    const data = await apiFetch<ApiAccount>("/settings", {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    setState(applyAccount(data));
  }, []);

  const unlinkEmail = useCallback(async () => {
    const data = await apiFetch<ApiAccount>("/settings/email/unlink", { method: "POST", body: "{}" });
    setState(applyAccount(data));
  }, []);

  const confirmEmail = useCallback(async (email: string, code: string) => {
    const data = await apiFetch<ApiAccount>("/settings/email/confirm", {
      method: "POST",
      body: JSON.stringify({ email, code }),
    });
    setState(applyAccount(data));
  }, []);

  const value = useMemo<AccountCtx>(
    () => ({
      ...state,
      ready,
      loading,
      authenticated,
      error,
      botUsername,
      authModalOpen,
      requireAuth,
      closeAuthModal,
      buy,
      createPaymentIntent,
      getPaymentIntent,
      completePayment,
      activatePromo,
      touchCountry,
      updateSettings,
      confirmEmail,
      unlinkEmail,
      refresh,
    }),
    [state, ready, loading, authenticated, error, botUsername, authModalOpen, requireAuth, closeAuthModal, buy, createPaymentIntent, getPaymentIntent, completePayment, activatePromo, touchCountry, updateSettings, confirmEmail, unlinkEmail, refresh],
  );

  return (
    <AccountCtx.Provider value={value}>
      {children}
      <TelegramAuthModal
        open={authModalOpen}
        botUsername={botUsername}
        busy={authBusy}
        error={authError}
        onClose={closeAuthModal}
        onAuth={(user) => {
          void loginWithTelegram(user);
        }}
      />
    </AccountCtx.Provider>
  );
}

export function AuthGate({ children }: { children: ReactNode }) {
  const { loading, authenticated, requireAuth } = useAccount();
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    if (loading) return;
    requireAuth(() => setAllowed(true));
  }, [loading, requireAuth]);

  useEffect(() => {
    if (authenticated) setAllowed(true);
  }, [authenticated]);

  if (loading) return null;
  if (!allowed && !authenticated) return null;
  return <>{children}</>;
}

export function useAccount(): AccountCtx {
  const ctx = useContext(AccountCtx);
  if (!ctx) throw new Error("useAccount must be used inside <AccountProvider>");
  return ctx;
}

export function Screen({
  children,
  pad = "16px 16px 100px",
}: {
  children: ReactNode;
  pad?: string;
}) {
  return (
    <div
      style={{
        maxWidth: "var(--maxw)",
        margin: "0 auto",
        minHeight: "100vh",
        background: "var(--bg)",
        color: "var(--text)",
        fontFamily: "var(--font)",
        padding: pad,
        transition: "background .2s",
      }}
    >
      {children}
    </div>
  );
}

const labelStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontSize: "var(--fs-sm)",
  color: "var(--text-dim)",
  textTransform: "uppercase",
  letterSpacing: ".6px",
  fontWeight: 700,
  margin: "0 2px 11px",
};

export function SectionLabel({ children }: { children: ReactNode }) {
  return <div style={labelStyle}>{children}</div>;
}

const LANG_STEP = 37;
const flagUrl = (code: string) => `/flags/${code.toLowerCase()}.svg`;
const flagLoaded = new Set<string>();

export function preloadFlags(codes: string[]) {
  for (const code of codes) {
    const c = code.toLowerCase();
    if (flagLoaded.has(c) || c.length !== 2) continue;
    flagLoaded.add(c);
    const img = new Image();
    img.src = flagUrl(c);
  }
}

function LangSwitch() {
  const { lang, setLang } = useI18n();
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef(false);
  const [pillX, setPillX] = useState(lang === "ru" ? 0 : LANG_STEP);
  const [snapping, setSnapping] = useState(true);

  useEffect(() => {
    preloadFlags(["ru", "gb"]);
  }, []);

  const selectLang = (target: Lang) => {
    setSnapping(true);
    setPillX(target === "ru" ? 0 : LANG_STEP);
    setLang(target);
  };

  const xFromEvent = (clientX: number) => {
    const r = trackRef.current?.getBoundingClientRect();
    if (!r) return pillX;
    return Math.max(0, Math.min(LANG_STEP, clientX - r.left - 3 - 17));
  };

  const commit = (x: number) => {
    const target: Lang = x > LANG_STEP / 2 ? "en" : "ru";
    setSnapping(true);
    setPillX(target === "ru" ? 0 : LANG_STEP);
    setLang(target);
    dragRef.current = false;
  };

  return (
    <div
      ref={trackRef}
      className="lang-track"
      role="group"
      aria-label="Language"
      style={{ cursor: snapping ? "default" : "grabbing" }}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest(".lang-btn")) return;
        dragRef.current = true;
        setSnapping(false);
        setPillX(xFromEvent(e.clientX));
        trackRef.current?.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!dragRef.current) return;
        setPillX(xFromEvent(e.clientX));
      }}
      onPointerUp={(e) => {
        if (!dragRef.current) return;
        commit(xFromEvent(e.clientX));
        trackRef.current?.releasePointerCapture(e.pointerId);
      }}
      onPointerCancel={() => {
        dragRef.current = false;
        setSnapping(true);
        setPillX(lang === "ru" ? 0 : LANG_STEP);
      }}
    >
      <div className={`lang-pill${snapping ? " snap" : ""}`} style={{ left: 3 + pillX }} />
      <button
        type="button"
        className="lang-btn"
        onClick={() => selectLang("ru")}
        aria-pressed={lang === "ru"}
        aria-label="Русский"
      >
        <img className="lang-flag" src={flagUrl("ru")} alt="" width={18} height={13} draggable={false} />
      </button>
      <button
        type="button"
        className="lang-btn"
        onClick={() => selectLang("en")}
        aria-pressed={lang === "en"}
        aria-label="English"
      >
        <img className="lang-flag" src={flagUrl("gb")} alt="" width={18} height={13} draggable={false} />
      </button>
    </div>
  );
}

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button type="button" className="theme-btn" onClick={toggle} aria-label={theme === "dark" ? "Light theme" : "Dark theme"}>
      <span className="theme-icons">
        <Sun size={16} className="sun-icon" />
        <Moon size={16} className="moon-icon" />
      </span>
    </button>
  );
}

export function SettingsToggles() {
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <LangSwitch />
      <ThemeToggle />
    </div>
  );
}

export function Flag({ code, size = 30 }: { code: string; size?: number }) {
  const h = Math.round(size * 0.72);
  const ref = useRef<HTMLSpanElement>(null);
  const [show, setShow] = useState(false);
  const [loaded, setLoaded] = useState(() => flagLoaded.has(code.toLowerCase()));

  useEffect(() => {
    if (isRegion(code)) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setShow(true);
          io.disconnect();
        }
      },
      { rootMargin: "180px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [code]);

  useEffect(() => {
    if (!show || isRegion(code)) return;
    const c = code.toLowerCase();
    if (flagLoaded.has(c)) {
      setLoaded(true);
      return;
    }
    const img = new Image();
    img.onload = () => {
      flagLoaded.add(c);
      setLoaded(true);
    };
    img.src = flagUrl(c);
  }, [show, code]);

  if (isRegion(code)) {
    return (
      <span
        ref={ref}
        style={{
          width: size,
          height: h,
          borderRadius: 5,
          background: "var(--chip)",
          display: "inline-grid",
          placeItems: "center",
          color: "var(--accent)",
          flexShrink: 0,
        }}
      >
        <Globe2 size={Math.round(size * 0.58)} />
      </span>
    );
  }

  return (
    <span ref={ref} style={{ width: size, height: h, flexShrink: 0, display: "inline-block" }}>
      {show && (
        <img
          className={`flag-img${loaded ? " loaded" : " loading"}`}
          src={flagUrl(code)}
          alt=""
          width={size}
          height={h}
          loading="lazy"
          decoding="async"
          draggable={false}
        />
      )}
    </span>
  );
}
