import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatDate, formatUsd } from "../components/api";
import { ErrorBox, Page, TableWrap, Td, Th } from "../components/ui";

export default function Transactions() {
  const [items, setItems] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    api.transactions(new URLSearchParams({ offset: "0", limit: "150" }))
      .then((r) => {
        setItems(r.items);
        setTotal(r.total);
      })
      .catch((e) => setError(e.message));
  }, []);

  return (
    <Page title="Транзакции баланса">
      {error && <ErrorBox text={error} />}
      <div style={{ marginBottom: 10, color: "#888", fontSize: 13 }}>Всего: {total}</div>
      <TableWrap>
        <thead>
          <tr>
            <Th>ID</Th>
            <Th>Пользователь</Th>
            <Th>Δ USD</Th>
            <Th>После</Th>
            <Th>Тип</Th>
            <Th>Ref</Th>
            <Th>Дата</Th>
          </tr>
        </thead>
        <tbody>
          {items.map((t) => (
            <tr key={String(t.id)}>
              <Td>{String(t.id)}</Td>
              <Td>
                <Link to={`/users/${t.user_id}`} style={{ color: "#ff8c1a" }}>
                  #{String(t.user_id)}
                </Link>
              </Td>
              <Td>{formatUsd(Number(t.delta_usd))}</Td>
              <Td>{formatUsd(Number(t.balance_after))}</Td>
              <Td>{String(t.kind)}</Td>
              <Td>{String(t.reference_id || "")}</Td>
              <Td>{formatDate(String(t.created_at))}</Td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </Page>
  );
}
