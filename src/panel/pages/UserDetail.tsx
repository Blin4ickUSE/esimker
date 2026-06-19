import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, formatDate, formatUsd } from "../components/api";
import { Btn, Card, ErrorBox, Input, Page, TableWrap, Td, Th } from "../components/ui";

export default function UserDetail() {
  const { id } = useParams();
  const userId = Number(id);
  const [data, setData] = useState<Awaited<ReturnType<typeof api.user>> | null>(null);
  const [error, setError] = useState("");
  const [delta, setDelta] = useState("");
  const [note, setNote] = useState("Корректировка админом");
  const [busy, setBusy] = useState(false);

  const load = () => {
    api.user(userId).then(setData).catch((e) => setError(e.message));
  };

  useEffect(() => {
    load();
  }, [userId]);

  const patch = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError("");
    try {
      const res = await api.patchUser(userId, body);
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  };

  if (!data) {
    return (
      <Page title="Пользователь">
        {error ? <ErrorBox text={error} /> : <div style={{ color: "#888" }}>Загрузка…</div>}
      </Page>
    );
  }

  const u = data.user;
  const blocked = Boolean(u.is_blocked);

  return (
    <Page
      title={`Пользователь ${userId}`}
      actions={<Link to="/users" style={{ color: "#ff8c1a", fontSize: 14 }}>← к списку</Link>}
    >
      {error && <ErrorBox text={error} />}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 12, fontSize: 14 }}>
          <div><b>Telegram ID:</b> {String(u.telegram_id)}</div>
          <div><b>Email:</b> {String(u.email || "—")}</div>
          <div><b>Баланс:</b> {formatUsd(Number(u.balance))}</div>
          <div><b>Реф. код:</b> {String(u.referral_code)}</div>
          <div><b>Создан:</b> {formatDate(String(u.created_at))}</div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
          <Btn variant={blocked ? "primary" : "danger"} disabled={busy} onClick={() => patch({ isBlocked: !blocked })}>
            {blocked ? "Разблокировать" : "Заблокировать"}
          </Btn>
        </div>
      </Card>

      <Card style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Корректировка баланса</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <Input value={delta} onChange={setDelta} placeholder="+10 или -5" style={{ width: 140 }} />
          <Input value={note} onChange={setNote} placeholder="Комментарий" style={{ flex: 1, minWidth: 200 }} />
          <Btn
            disabled={busy || !delta.trim()}
            onClick={() => patch({ balanceDelta: Number(delta.replace(",", ".")), note })}
          >
            Применить
          </Btn>
        </div>
      </Card>

      <h3>eSIM ({data.esims.length})</h3>
      <TableWrap>
        <thead><tr><Th>ID</Th><Th>Страна</Th><Th>ICCID</Th><Th>Статус</Th><Th>Сумма</Th></tr></thead>
        <tbody>
          {data.esims.map((e) => (
            <tr key={String(e.id)}>
              <Td>{String(e.id)}</Td>
              <Td>{String(e.country_code)}</Td>
              <Td style={{ fontFamily: "monospace", fontSize: 11 }}>{String(e.iccid || "—")}</Td>
              <Td>{String(e.status)}</Td>
              <Td>{formatUsd(Number(e.usd))}</Td>
            </tr>
          ))}
        </tbody>
      </TableWrap>

      <h3>Заказы ({data.orders.length})</h3>
      <TableWrap>
        <thead><tr><Th>ID</Th><Th>Название</Th><Th>Сумма</Th><Th>Оплата</Th><Th>Дата</Th></tr></thead>
        <tbody>
          {data.orders.map((o) => (
            <tr key={String(o.id)}>
              <Td>{String(o.id)}</Td>
              <Td>{String(o.name)}</Td>
              <Td>{formatUsd(Number(o.amount_usd))}</Td>
              <Td>{String(o.payment_method)}</Td>
              <Td>{formatDate(String(o.created_at))}</Td>
            </tr>
          ))}
        </tbody>
      </TableWrap>

      <h3>Транзакции баланса</h3>
      <TableWrap>
        <thead><tr><Th>Дата</Th><Th>Δ</Th><Th>После</Th><Th>Тип</Th><Th>Примечание</Th></tr></thead>
        <tbody>
          {data.balanceTransactions.map((t, i) => (
            <tr key={i}>
              <Td>{formatDate(String(t.created_at))}</Td>
              <Td>{formatUsd(Number(t.delta_usd))}</Td>
              <Td>{formatUsd(Number(t.balance_after))}</Td>
              <Td>{String(t.kind)}</Td>
              <Td>{String(t.note || "")}</Td>
            </tr>
          ))}
        </tbody>
      </TableWrap>

      <details style={{ marginTop: 20 }}>
        <summary style={{ cursor: "pointer", color: "#ff8c1a" }}>Сырой JSON аккаунта</summary>
        <pre style={{ background: "#111", padding: 12, overflow: "auto", fontSize: 11, borderRadius: 8 }}>
          {JSON.stringify(data, null, 2)}
        </pre>
      </details>
    </Page>
  );
}
