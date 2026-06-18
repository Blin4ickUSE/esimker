import { useEffect, useState } from "react";
import { api, formatUsd, type PromoRow } from "../components/api";
import { Btn, Card, ErrorBox, Input, Page, TableWrap, Td, Th } from "../components/ui";

export default function Promos() {
  const [items, setItems] = useState<PromoRow[]>([]);
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const [credit, setCredit] = useState("5");

  const load = () => {
    api.promos()
      .then((r) => setItems(r.items))
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    try {
      await api.createPromo({ code: code.toUpperCase(), creditUsd: Number(credit) });
      setCode("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    }
  };

  const toggle = async (p: PromoRow) => {
    await api.patchPromo(p.code, { active: !p.active });
    load();
  };

  return (
    <Page title="Промокоды">
      {error && <ErrorBox text={error} />}
      <Card style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Новый промокод</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Input value={code} onChange={setCode} placeholder="КОД" style={{ width: 140 }} />
          <Input value={credit} onChange={setCredit} placeholder="USD" style={{ width: 100 }} />
          <Btn onClick={create} disabled={!code.trim()}>
            Создать
          </Btn>
        </div>
      </Card>
      <TableWrap>
        <thead>
          <tr>
            <Th>Код</Th>
            <Th>Кредит</Th>
            <Th>Использовано</Th>
            <Th>Лимит</Th>
            <Th>Активен</Th>
            <Th></Th>
          </tr>
        </thead>
        <tbody>
          {items.map((p) => (
            <tr key={p.code}>
              <Td>{p.code}</Td>
              <Td>{formatUsd(p.credit_usd)}</Td>
              <Td>{p.used_count}</Td>
              <Td>{p.max_uses ?? "∞"}</Td>
              <Td>{p.active ? "да" : "нет"}</Td>
              <Td>
                <Btn variant="ghost" onClick={() => toggle(p)}>
                  {p.active ? "Выключить" : "Включить"}
                </Btn>
              </Td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </Page>
  );
}
