import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const TOKEN_KEY = "esimker.panel.token";
const API = "/api/admin";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = localStorage.getItem(TOKEN_KEY);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API}${path}`, { ...init, headers });
  const data = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) {
    throw new ApiError(res.status, data.error || `HTTP ${res.status}`);
  }
  return data as T;
}

export const api = {
  login: (login: string, password: string) =>
    request<{ token: string; login: string }>("/login", {
      method: "POST",
      body: JSON.stringify({ login, password }),
    }),
  me: () => request<{ login: string }>("/me"),
  stats: () => request<DashboardStats>("/stats"),
  users: (params: URLSearchParams) =>
    request<Paged<UserRow>>(`/users?${params}`),
  user: (telegramId: number) => request<UserDetail>(`/users/${telegramId}`),
  patchUser: (telegramId: number, body: Record<string, unknown>) =>
    request<UserDetail>(`/users/${telegramId}`, { method: "PATCH", body: JSON.stringify(body) }),
  orders: (params: URLSearchParams) =>
    request<Paged<Record<string, unknown>>>(`/orders?${params}`),
  esims: (params: URLSearchParams) =>
    request<Paged<Record<string, unknown>>>(`/esims?${params}`),
  payments: (params: URLSearchParams) =>
    request<Paged<Record<string, unknown>>>(`/payments?${params}`),
  promos: () => request<{ items: PromoRow[] }>("/promos"),
  createPromo: (body: Record<string, unknown>) =>
    request<PromoRow>("/promos", { method: "POST", body: JSON.stringify(body) }),
  patchPromo: (code: string, body: Record<string, unknown>) =>
    request<PromoRow>(`/promos/${encodeURIComponent(code)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deletePromo: (code: string) =>
    request<{ ok: boolean }>(`/promos/${encodeURIComponent(code)}`, { method: "DELETE" }),
  resolveUsernames: (telegramIds: number[]) =>
    request<{ usernames: Record<string, string> }>("/users/usernames", {
      method: "POST",
      body: JSON.stringify({ telegramIds }),
    }),
  referrals: () => request<ReferralStats>("/referrals"),
  broadcasts: () => request<{ items: Record<string, unknown>[] }>("/broadcasts"),
  sendBroadcast: (body: Record<string, unknown>) =>
    request<{ id: string; kind: string; sent: number; failed: number }>("/broadcasts", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  tables: () => request<{ tables: string[] }>("/tables"),
  table: (name: string, params: URLSearchParams) =>
    request<TableBrowse>(`/tables/${name}?${params}`),
};

export interface Paged<T> {
  total: number;
  items: T[];
  offset: number;
  limit: number;
}

export interface UserRow {
  telegram_id: number;
  balance: number;
  referral_code: string;
  is_blocked: number;
  created_at: string;
}

export interface UserDetail {
  user: Record<string, unknown>;
  esims: Record<string, unknown>[];
  orders: Record<string, unknown>[];
  balanceTransactions: Record<string, unknown>[];
  account: Record<string, unknown>;
}

export interface DashboardStats {
  users: number;
  blockedUsers: number;
  orders: number;
  esims: number;
  revenueUsd: number;
  revenueTodayUsd: number;
  ordersToday: number;
  balanceTotalUsd: number;
  pendingPayments: number;
  referralPaidUsd: number;
  topCountries: { country_code: string; orders_count: number; revenue_usd: number }[];
}

export interface PromoRow {
  code: string;
  credit_usd: number;
  max_uses: number | null;
  active: number;
  used_count: number;
}

export interface ReferralStats {
  topReferrers: Record<string, unknown>[];
  recentEarnings: Record<string, unknown>[];
}

export interface TableBrowse {
  table: string;
  total: number;
  items: Record<string, unknown>[];
  offset: number;
  limit: number;
}

interface AuthCtx {
  token: string | null;
  login: string | null;
  signIn: (login: string, password: string) => Promise<void>;
  signOut: () => void;
  ready: boolean;
}

const AuthCtx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [login, setLogin] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!token) {
      setReady(true);
      return;
    }
    api
      .me()
      .then((r) => setLogin(r.login))
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
      })
      .finally(() => setReady(true));
  }, [token]);

  const signIn = useCallback(async (user: string, password: string) => {
    const res = await api.login(user, password);
    localStorage.setItem(TOKEN_KEY, res.token);
    setToken(res.token);
    setLogin(res.login);
  }, []);

  const signOut = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setLogin(null);
  }, []);

  const value = useMemo(
    () => ({ token, login, signIn, signOut, ready }),
    [token, login, signIn, signOut, ready],
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthCtx {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth outside provider");
  return ctx;
}

export function formatUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

export function formatDate(s: string | null | undefined): string {
  if (!s) return "—";
  return new Date(s).toLocaleString("ru-RU");
}
