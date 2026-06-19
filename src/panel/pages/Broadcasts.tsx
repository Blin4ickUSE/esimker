import { useEffect, useState } from "react";
import { api } from "../components/api";
import { Btn, Card, ErrorBox, Page } from "../components/ui";

type Kind = "news" | "marketing";

export default function Broadcasts() {
  const [items, setItems] = useState<Record<string, unknown>[]>([]);
  const [kind, setKind] = useState<Kind>("news");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");

  const load = () => {
    api.broadcasts().then((r) => setItems(r.items)).catch((e) => setError(e.message));
  };

  useEffect(() => {
    load();
  }, []);

  const send = async () => {
    setBusy(true);
    setError("");
    setResult("");
    try {
      const res = await api.sendBroadcast({ kind, message });
      setResult(`Отправлено: ${res.sent}, ошибок: ${res.failed}`);
      setMessage("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page title="Рассылки">
      {error && <ErrorBox text={error} />}
      <Card style={{ marginBottom: 20 }}>
        <p style={{ color: "#aaa", fontSize: 14, marginTop: 0 }}>
          Новости — пользователям с включёнными «Новости». Маркетинг — с включённым «Маркетинг».
        </p>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <Btn variant={kind === "news" ? "primary" : "ghost"} onClick={() => setKind("news")}>
            Новость
          </Btn>
          <Btn variant={kind === "marketing" ? "primary" : "ghost"} onClick={() => setKind("marketing")}>
            Маркетинг
          </Btn>
        </div>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Текст сообщения (HTML поддерживается)"
          rows={6}
          style={{
            width: "100%",
            boxSizing: "border-box",
            background: "#111",
            border: "1px solid #333",
            borderRadius: 8,
            color: "#eee",
            padding: 12,
            marginBottom: 12,
            fontFamily: "inherit",
          }}
        />
        <Btn disabled={busy || !message.trim()} onClick={send}>
          Отправить
        </Btn>
        {result && <div style={{ marginTop: 12, color: "#8f8" }}>{result}</div>}
      </Card>

      <h3 style={{ fontSize: 16 }}>История</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {items.map((b) => (
          <Card key={String(b.id)} style={{ fontSize: 13 }}>
            <div style={{ color: "#888", marginBottom: 6 }}>
              {String(b.kind)} · {String(b.created_at)} · ✓{String(b.sent_count)} / ✗{String(b.failed_count)}
            </div>
            <div style={{ whiteSpace: "pre-wrap" }}>{String(b.message)}</div>
          </Card>
        ))}
        {!items.length && <div style={{ color: "#666" }}>Пока нет рассылок</div>}
      </div>
    </Page>
  );
}
