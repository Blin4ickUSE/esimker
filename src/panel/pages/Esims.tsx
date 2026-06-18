import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatDate, formatUsd } from "../components/api";
import { Btn, ErrorBox, Input, Page, TableWrap, Td, Th } from "../components/ui";

export default function Esims() {
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");

  const load = () => {
    const p = new URLSearchParams({ offset: "0", limit: "100" });
    if (search.trim()) p.set("search", search.trim());
    api.esims(p)
      .then((r) => {
        setItems(r.items);
        setTotal(r.total);
      })
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <Page
      title="eSIM профили"
      actions={
        <div style={{ display: "flex", gap: 8 }}>
          <Input value={search} onChange={setSearch} placeholder="ICCID / ID / user" style={{ width: 220 }} />
          <Btn onClick={load}>Найти</Btn>
        </div>
      }
    >
      {error && <ErrorBox text={error} />}
      <div style={{ marginBottom: 10, color: "#888", fontSize: 13 }}>Всего: {total}</div>
      <TableWrap>
        <thead>
          <tr>
            <Th>ID</Th>
            <Th>Пользователь</Th>
            <Th>Страна</Th>
            <Th>ICCID</Th>
            <Th>Статус</Th>
            <Th>Трафик</Th>
            <Th>Цена</Th>
            <Th>Куплен</Th>
          </tr>
        </thead>
        <tbody>
          {items.map((e) => (
            <tr key={String(e.id)}>
              <Td>{String(e.id)}</Td>
              <Td>
                <Link to={`/users/${e.user_id}`} style={{ color: "#ff8c1a" }}>
                  #{String(e.user_id)}
                </Link>
              </Td>
              <Td>{String(e.country_code)}</Td>
              <Td style={{ fontFamily: "monospace", fontSize: 11 }}>{String(e.iccid || "—")}</Td>
              <Td>{String(e.status)}</Td>
              <Td>
                {e.data_remaining_gb != null ? `${e.data_remaining_gb} ГБ` : "—"}
              </Td>
              <Td>{formatUsd(Number(e.usd))}</Td>
              <Td>{formatDate(String(e.purchased_at))}</Td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </Page>
  );
}
