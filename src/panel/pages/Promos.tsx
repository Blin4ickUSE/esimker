import { useEffect, useState } from "react";
import { api, formatUsd, type PromoRow } from "../components/api";
import { Btn, Card, ErrorBox, Input, Page, TableWrap, Td, Th } from "../components/ui";

export default function Promos() {
  const [items, setItems] = useState<PromoRow[]>([]);
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const [credit, setCredit] = useState("5");
  const [maxUses, setMaxUses] = useState("");
  const [editing, setEditing] = useState<PromoRow | null>(null);
  const [editCredit, setEditCredit] = useState("");
  const [editMaxUses, setEditMaxUses] = useState("");

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
      const body: Record<string, unknown> = {
        code: code.toUpperCase(),
        creditUsd: Number(credit),
      };
      if (maxUses.trim()) body.maxUses = Number(maxUses);
      await api.createPromo(body);
      setCode("");
      setMaxUses("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    }
  };

  const toggle = async (p: PromoRow) => {
    await api.patchPromo(p.code, { active: !p.active });
    load();
  };

  const startEdit = (p: PromoRow) => {
    setEditing(p);
    setEditCredit(String(p.credit_usd));
    setEditMaxUses(p.max_uses != null ? String(p.max_uses) : "");
  };

  const saveEdit = async () => {
    if (!editing) return;
    try {
      const body: Record<string, unknown> = { creditUsd: Number(editCredit) };
      body.maxUses = editMaxUses.trim() ? Number(editMaxUses) : null;
      await api.patchPromo(editing.code, body);
      setEditing(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    }
  };

  const remove = async (p: PromoRow) => {
    if (!window.confirm(`Удалить промокод ${p.code}?`)) return;
    try {
      await api.deletePromo(p.code);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    }
  };

  return (
    <Page title="Промокоды">
      {error && <ErrorBox text={error} />}
      <Card style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Новый промокод</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Input value={code} onChange={setCode} placeholder="КОД" style={{ width: 140 }} />
          <Input value={credit} onChange={setCredit} placeholder="USD" style={{ width: 100 }} />
          <Input
            value={maxUses}
            onChange={setMaxUses}
            placeholder="Лимит (пусто = ∞)"
            style={{ width: 150 }}
          />
          <Btn onClick={create} disabled={!code.trim()}>
            Создать
          </Btn>
        </div>
      </Card>

      {editing && (
        <Card style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>Редактировать {editing.code}</h3>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Input value={editCredit} onChange={setEditCredit} placeholder="USD" style={{ width: 100 }} />
            <Input
              value={editMaxUses}
              onChange={setEditMaxUses}
              placeholder="Лимит (пусто = ∞)"
              style={{ width: 150 }}
            />
            <Btn onClick={saveEdit}>Сохранить</Btn>
            <Btn variant="ghost" onClick={() => setEditing(null)}>
              Отмена
            </Btn>
          </div>
        </Card>
      )}

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
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <Btn variant="ghost" onClick={() => toggle(p)}>
                    {p.active ? "Выкл" : "Вкл"}
                  </Btn>
                  <Btn variant="ghost" onClick={() => startEdit(p)}>
                    Изменить
                  </Btn>
                  <Btn variant="danger" onClick={() => remove(p)}>
                    Удалить
                  </Btn>
                </div>
              </Td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </Page>
  );
}
