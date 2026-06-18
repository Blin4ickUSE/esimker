import { useEffect, useState } from "react";
import { api } from "../components/api";
import { Btn, Card, ErrorBox, Page } from "../components/ui";

export default function Popular() {
  const [countries, setCountries] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  const load = () => {
    api.popular()
      .then((r) => {
        setCountries(r.countries);
        setDraft(r.countries.join("\n"));
      })
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    setError("");
    setOk("");
    const list = draft
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      const r = await api.setPopular(list);
      setCountries(r.countries);
      setOk("Сохранено");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    }
  };

  return (
    <Page title="Популярные направления">
      {error && <ErrorBox text={error} />}
      {ok && <div style={{ color: "#6f6", marginBottom: 12 }}>{ok}</div>}
      <Card>
        <p style={{ color: "#888", fontSize: 14 }}>
          Список стран на главной (английские названия, по одной на строку). Сейчас: {countries.length}
        </p>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          style={{
            width: "100%",
            minHeight: 280,
            background: "#0a0a0a",
            border: "1px solid #333",
            borderRadius: 8,
            color: "#f2f2f2",
            padding: 12,
            fontFamily: "monospace",
            fontSize: 13,
            boxSizing: "border-box",
          }}
        />
        <div style={{ marginTop: 12 }}>
          <Btn onClick={save}>Сохранить</Btn>
        </div>
      </Card>
    </Page>
  );
}
