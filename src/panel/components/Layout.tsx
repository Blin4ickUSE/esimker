import type { CSSProperties } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { Megaphone, BarChart3, CreditCard, Database, Gift, LayoutDashboard, LogOut, Receipt, Smartphone, Users } from "lucide-react";
import { useAuth } from "./api";

const nav = [
  { to: "/", label: "Обзор", icon: LayoutDashboard },
  { to: "/users", label: "Пользователи", icon: Users },
  { to: "/orders", label: "Заказы", icon: Receipt },
  { to: "/esims", label: "eSIM", icon: Smartphone },
  { to: "/payments", label: "Платежи", icon: CreditCard },
  { to: "/promos", label: "Промокоды", icon: Gift },
  { to: "/referrals", label: "Рефералы", icon: BarChart3 },
  { to: "/broadcasts", label: "Рассылки", icon: Megaphone },
  { to: "/data", label: "База данных", icon: Database },
];

export default function Layout() {
  const { login, signOut } = useAuth();
  const navigate = useNavigate();

  const onLogout = () => {
    signOut();
    navigate("/login");
  };

  return (
    <div style={s.shell}>
      <aside style={s.aside}>
        <div style={s.brand}>
          <span style={s.brandMark}>e</span>
          <div>
            <div style={s.brandTitle}>esimker</div>
            <div style={s.brandSub}>панель управления</div>
          </div>
        </div>
        <nav style={s.nav}>
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              style={({ isActive }) => ({ ...s.navLink, ...(isActive ? s.navActive : null) })}
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div style={s.footer}>
          <div style={s.user}>{login}</div>
          <button type="button" style={s.logout} onClick={onLogout}>
            <LogOut size={16} /> Выйти
          </button>
        </div>
      </aside>
      <main style={s.main}>
        <Outlet />
      </main>
    </div>
  );
}

const s: Record<string, CSSProperties> = {
  shell: {
    display: "flex",
    minHeight: "100vh",
    background: "#0a0a0a",
    color: "#f2f2f2",
    fontFamily: "Inter, system-ui, sans-serif",
  },
  aside: {
    width: 248,
    borderRight: "1px solid #222",
    display: "flex",
    flexDirection: "column",
    padding: "20px 14px",
    background: "#0d0d0d",
  },
  brand: { display: "flex", gap: 12, alignItems: "center", marginBottom: 28, padding: "0 8px" },
  brandMark: {
    width: 40,
    height: 40,
    borderRadius: 10,
    background: "linear-gradient(135deg,#ff6b00,#ff9500)",
    display: "grid",
    placeItems: "center",
    fontWeight: 800,
    color: "#0a0a0a",
    fontSize: 20,
  },
  brandTitle: { fontWeight: 700, fontSize: 18 },
  brandSub: { fontSize: 12, color: "#888" },
  nav: { display: "flex", flexDirection: "column", gap: 4, flex: 1 },
  navLink: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    borderRadius: 8,
    color: "#bbb",
    textDecoration: "none",
    fontSize: 14,
    fontWeight: 500,
  },
  navActive: { background: "#1a1208", color: "#ff8c1a" },
  footer: { borderTop: "1px solid #222", paddingTop: 14, marginTop: 14 },
  user: { fontSize: 13, color: "#888", marginBottom: 10, padding: "0 8px" },
  logout: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    border: "1px solid #333",
    background: "transparent",
    color: "#ccc",
    borderRadius: 8,
    padding: "9px 12px",
    cursor: "pointer",
    fontSize: 14,
  },
  main: { flex: 1, padding: 28, overflow: "auto" },
};
