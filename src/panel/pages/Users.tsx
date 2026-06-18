import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type UserRow } from "../components/api";
import { Btn, ErrorBox, Input, Page, TableWrap, Td, Th } from "../components/ui";

export default function Users() {
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState("");
  const limit = 50;

  const load = (off = offset) => {
    const p = new URLSearchParams({ offset: String(off), limit: String(limit) });
    if (search.trim()) p.set("search", search.trim());
    api.users(p)
      .then((r) => {
        setItems(r.items);
        setTotal(r.total);
        setOffset(r.offset);
      })
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    load(0);
  }, []);

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
            <Th>ID</Th>
            <Th>Telegram</Th>
            <Th>Имя</Th>
            <Th>Баланс</Th>
            <Th>Реф. код</Th>
            <Th>Статус</Th>
            <Th></Th>
          </tr>
        </thead>
        <tbody>
          {items.map((u) => (
            <tr key={u.id}>
              <Td>{u.id}</Td>
              <Td>{u.telegram_id}</Td>
              <Td>@{u.username || "—"} {u.first_name || ""}</Td>
              <Td>${u.balance_usd.toFixed(2)}</Td>
              <Td>{u.referral_code}</Td>
              <Td>{u.is_blocked ? "🚫 блок" : "активен"}</Td>
              <Td>
                <Link to={`/users/${u.id}`} style={{ color: "#ff8c1a" }}>
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
