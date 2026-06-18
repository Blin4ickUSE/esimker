import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatDate, formatUsd } from "../components/api";
import { Btn, ErrorBox, Page, TableWrap, Td, Th } from "../components/ui";

export default function Orders() {
  const [items, setItems] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState("");
  const limit = 50;

  const load = (off = 0) => {
    const p = new URLSearchParams({ offset: String(off), limit: String(limit) });
    api.orders(p)
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
    <Page title="Заказы">
      {error && <ErrorBox text={error} />}
      <div style={{ marginBottom: 10, color: "#888", fontSize: 13 }}>Всего: {total}</div>
      <TableWrap>
        <thead>
          <tr>
            <Th>ID</Th>
            <Th>Пользователь</Th>
            <Th>Тариф</Th>
            <Th>Страна</Th>
            <Th>ГБ/дни</Th>
            <Th>Сумма</Th>
            <Th>Оплата</Th>
            <Th>Статус</Th>
            <Th>Дата</Th>
          </tr>
        </thead>
        <tbody>
          {items.map((o) => (
            <tr key={String(o.id)}>
              <Td>{String(o.id)}</Td>
              <Td>
                <Link to={`/users/${o.user_id}`} style={{ color: "#ff8c1a" }}>
                  #{String(o.user_id)} @{String(o.username || "—")}
                </Link>
              </Td>
              <Td>{String(o.name)}</Td>
              <Td>{String(o.country_code)}</Td>
              <Td>
                {String(o.gb)} / {String(o.days)}д
              </Td>
              <Td>{formatUsd(Number(o.amount_usd))}</Td>
              <Td>{String(o.payment_method)}</Td>
              <Td>{String(o.status)}</Td>
              <Td>{formatDate(String(o.created_at))}</Td>
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
