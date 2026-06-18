import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatDate, formatUsd } from "../components/api";
import { ErrorBox, Page, TableWrap, Td, Th } from "../components/ui";

export default function Payments() {
  const [items, setItems] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    const p = new URLSearchParams({ offset: "0", limit: "100" });
    api.payments(p)
      .then((r) => {
        setItems(r.items);
        setTotal(r.total);
      })
      .catch((e) => setError(e.message));
  }, []);

  return (
    <Page title="Платёжные намерения">
      {error && <ErrorBox text={error} />}
      <div style={{ marginBottom: 10, color: "#888", fontSize: 13 }}>Всего: {total}</div>
      <TableWrap>
        <thead>
          <tr>
            <Th>ID</Th>
            <Th>Пользователь</Th>
            <Th>Тип</Th>
            <Th>Сумма</Th>
            <Th>Статус</Th>
            <Th>Метод</Th>
            <Th>Тариф</Th>
            <Th>Создан</Th>
          </tr>
        </thead>
        <tbody>
          {items.map((p) => (
            <tr key={String(p.id)}>
              <Td>{String(p.id)}</Td>
              <Td>
                <Link to={`/users/${p.user_id}`} style={{ color: "#ff8c1a" }}>
                  #{String(p.user_id)}
                </Link>
              </Td>
              <Td>{String(p.kind)}</Td>
              <Td>{formatUsd(Number(p.amount_usd))}</Td>
              <Td>{String(p.status)}</Td>
              <Td>{String(p.payment_method || "—")}</Td>
              <Td>{String(p.plan_name || "—")}</Td>
              <Td>{formatDate(String(p.created_at))}</Td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </Page>
  );
}
