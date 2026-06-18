import type { CSSProperties } from "react";
import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../components/api";
import { Btn, Card, ErrorBox, Input } from "../components/ui";

export default function Login() {
  const { token, signIn, ready } = useAuth();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (ready && token) return <Navigate to="/" replace />;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await signIn(login.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка входа");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={s.wrap}>
      <Card style={s.card}>
        <div style={s.logo}>e</div>
        <h1 style={s.title}>Панель esimker</h1>
        <p style={s.sub}>Вход для администратора</p>
        {error && <ErrorBox text={error} />}
        <form onSubmit={onSubmit}>
          <label style={s.label}>Логин</label>
          <Input value={login} onChange={setLogin} placeholder="admin" />
          <label style={s.label}>Пароль</label>
          <Input value={password} onChange={setPassword} type="password" placeholder="••••••••" />
          <Btn disabled={loading || !login || !password}>{loading ? "Вход…" : "Войти"}</Btn>
        </form>
      </Card>
    </div>
  );
}

const s: Record<string, CSSProperties> = {
  wrap: {
    minHeight: "100vh",
    display: "grid",
    placeItems: "center",
    background: "#0a0a0a",
    padding: 20,
  },
  card: { width: "100%", maxWidth: 380 },
  logo: {
    width: 52,
    height: 52,
    borderRadius: 12,
    background: "linear-gradient(135deg,#ff6b00,#ff9500)",
    display: "grid",
    placeItems: "center",
    fontWeight: 800,
    fontSize: 26,
    color: "#0a0a0a",
    marginBottom: 16,
  },
  title: { margin: "0 0 6px", fontSize: 24 },
  sub: { margin: "0 0 20px", color: "#888", fontSize: 14 },
  label: { display: "block", fontSize: 13, color: "#aaa", marginBottom: 6, marginTop: 12 },
};
