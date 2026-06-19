import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type UserRow } from "../components/api";
import { Btn, ErrorBox, Input, Page, TableWrap, Td, Th } from "../components/ui";

const USERNAME_CACHE_KEY = "esimker.panel.usernames";

function readUsernameCache(): Record<string, string> {
  try {
    const raw = localStorage.getItem(USERNAME_CACHE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeUsernameCache(cache: Record<string, string>) {
  localStorage.setItem(USERNAME_CACHE_KEY, JSON.stringify(cache));
}

export default function Users() {
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<UserRow[]>([]);
  const [usernames, setUsernames] = useState<Record<string, string>>(() => readUsernameCache());
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState("");
  const limit = 50;

  const resolveUsernames = useCallback(async (rows: UserRow[]) => {
    const cache = readUsernameCache();
    const missing = rows
      .map((u) => u.telegram_id)
      .filter((id) => !cache[String(id)]);
    if (missing.length === 0) return;
    try {
      const res = await api.resolveUsernames(missing);
      const next = { ...readUsernameCache() };
      for (const [id, name] of Object.entries(res.usernames)) {
        next[String(id)] = name;
      }
      writeUsernameCache(next);
      setUsernames(next);
    } catch {
      /* usernames are optional */
    }
  }, []);

  const load = (off = offset) => {
    const p = new URLSearchParams({ offset: String(off), limit: String(limit) });
    if (search.trim()) p.set("search", search.trim());
    api.users(p)
      .then((r) => {
        setItems(r.items);
        setTotal(r.total);
        setOffset(r.offset);
        void resolveUsernames(r.items);
      })
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    load(0);
  }, []);

  const label = (id: number) => {
    const username = usernames[String(id)];
    return username ? `@${username}` : String(id);
  };

  return (
    <Page
      title="Пользователи"
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          <Input value={search} onChange={setSearch} placeholder="Поиск…" style={{ width: 220 }} />
          <Btn onClick={() => load(0)}>Найти</Btn>
        </div>
      }
    >
      {error && <ErrorBox text={error} />}
      <div style={{ marginBottom: 10, color: "#888", fontSize: 13 }}>Всего: {total}</div>
      <TableWrap>
        <thead>
          <tr>
            <Th>Пользователь</Th>
            <Th>Telegram ID</Th>
            <Th>Баланс</Th>
            <Th>Реф. код</Th>
            <Th>Статус</Th>
            <Th></Th>
          </tr>
        </thead>
        <tbody>
          {items.map((u) => (
            <tr key={u.telegram_id}>
              <Td>{label(u.telegram_id)}</Td>
              <Td>{u.telegram_id}</Td>
              <Td>${Number(u.balance).toFixed(2)}</Td>
              <Td>{u.referral_code}</Td>
              <Td>{u.is_blocked ? "🚫 блок" : "активен"}</Td>
              <Td>
                <Link to={`/users/${u.telegram_id}`} style={{ color: "#ff8c1a" }}>
                  открыть
                </Link>
              </Td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <Btn variant="ghost" disabled={offset <= 0} onClick={() => load(offset - limit)}>
          Назад
        </Btn>
        <Btn variant="ghost" disabled={offset + limit >= total} onClick={() => load(offset + limit)}>
          Далее
        </Btn>
      </div>
    </Page>
  );
}
