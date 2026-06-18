import { useEffect, useState } from "react";
import { api } from "../components/api";
import { Btn, Card, ErrorBox, Page, TableWrap, Td, Th } from "../components/ui";

export default function DataBrowser() {
  const [tables, setTables] = useState<string[]>([]);
  const [table, setTable] = useState("users");
  const [items, setItems] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState("");
  const limit = 50;

  useEffect(() => {
    api.tables().then((r) => setTables(r.tables)).catch((e) => setError(e.message));
  }, []);

  const load = (name: string, off = 0) => {
    const p = new URLSearchParams({ offset: String(off), limit: String(limit) });
    api.table(name, p)
      .then((r) => {
        setItems(r.items);
        setTotal(r.total);
        setOffset(r.offset);
        setTable(r.table);
      })
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    if (table) load(table, 0);
  }, [table]);

  const columns =
    items.length > 0 ? Object.keys(items[0]) : [];

  return (
    <Page title="База данных">
      {error && <ErrorBox text={error} />}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {tables.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTable(t)}
              style={{
                border: "1px solid",
                borderColor: t === table ? "#ff6b00" : "#333",
                background: t === table ? "#1a1208" : "transparent",
                color: t === table ? "#ff8c1a" : "#aaa",
                borderRadius: 8,
                padding: "8px 12px",
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              {t}
            </button>
          ))}
        </div>
        <div style={{ marginTop: 12, color: "#888", fontSize: 13 }}>
          Таблица <b style={{ color: "#ff8c1a" }}>{table}</b> — записей: {total}
        </div>
      </Card>
      <TableWrap>
        <thead>
          <tr>
            {columns.map((c) => (
              <Th key={c}>{c}</Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((row, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <Td key={c}>
                  <span style={{ fontFamily: "monospace", fontSize: 11 }}>
                    {row[c] == null ? "—" : String(row[c])}
                  </span>
                </Td>
              ))}
            </tr>
          ))}
        </tbody>
      </TableWrap>
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <Btn variant="ghost" disabled={offset <= 0} onClick={() => load(table, offset - limit)}>
          Назад
        </Btn>
        <Btn variant="ghost" disabled={offset + limit >= total} onClick={() => load(table, offset + limit)}>
          Далее
        </Btn>
      </div>
    </Page>
  );
}
