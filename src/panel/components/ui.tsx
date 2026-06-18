import type { CSSProperties, ReactNode } from "react";

export function Page({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <div>
      <div style={s.head}>
        <h1 style={s.title}>{title}</h1>
        {actions}
      </div>
      {children}
    </div>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div style={{ ...s.card, ...style }}>{children}</div>;
}

export function StatGrid({ items }: { items: { label: string; value: string; hint?: string }[] }) {
  return (
    <div style={s.grid}>
      {items.map((item) => (
        <Card key={item.label}>
          <div style={s.statLabel}>{item.label}</div>
          <div style={s.statValue}>{item.value}</div>
          {item.hint && <div style={s.statHint}>{item.hint}</div>}
        </Card>
      ))}
    </div>
  );
}

export function TableWrap({ children }: { children: ReactNode }) {
  return (
    <Card style={{ padding: 0, overflow: "auto" }}>
      <table style={s.table}>{children}</table>
    </Card>
  );
}

export function Th({ children }: { children?: ReactNode }) {
  return <th style={s.th}>{children ?? "\u00a0"}</th>;
}

export function Td({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <td style={{ ...s.td, ...style }}>{children}</td>;
}

export function Btn({
  children,
  onClick,
  variant = "primary",
  disabled,
  type = "button",
  style,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "danger";
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
  style?: CSSProperties;
}) {
  const base = variant === "primary" ? s.btn : variant === "danger" ? s.btnDanger : s.btnGhost;
  return (
    <button
      type={type}
      style={{ ...base, ...(disabled ? s.btnDisabled : null), ...style }}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export function Input({
  value,
  onChange,
  placeholder,
  type = "text",
  style,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  style?: CSSProperties;
}) {
  return (
    <input
      style={{ ...s.input, ...style }}
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function ErrorBox({ text }: { text: string }) {
  return <div style={s.error}>{text}</div>;
}

const s: Record<string, CSSProperties> = {
  head: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, gap: 12 },
  title: { margin: 0, fontSize: 26, fontWeight: 700 },
  card: {
    background: "#111",
    border: "1px solid #222",
    borderRadius: 12,
    padding: 16,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
    gap: 14,
    marginBottom: 20,
  },
  statLabel: { fontSize: 13, color: "#888", marginBottom: 6 },
  statValue: { fontSize: 24, fontWeight: 700, color: "#ff8c1a" },
  statHint: { fontSize: 12, color: "#666", marginTop: 4 },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: {
    textAlign: "left",
    padding: "12px 14px",
    borderBottom: "1px solid #222",
    color: "#888",
    fontWeight: 600,
    whiteSpace: "nowrap",
  },
  td: {
    padding: "11px 14px",
    borderBottom: "1px solid #1a1a1a",
    verticalAlign: "top",
  },
  btn: {
    border: "none",
    borderRadius: 8,
    padding: "9px 14px",
    background: "linear-gradient(135deg,#ff6b00,#ff9500)",
    color: "#0a0a0a",
    fontWeight: 700,
    cursor: "pointer",
    fontSize: 14,
  },
  btnDisabled: {
    opacity: 0.45,
    cursor: "not-allowed",
  },
  btnGhost: {
    border: "1px solid #333",
    borderRadius: 8,
    padding: "9px 14px",
    background: "transparent",
    color: "#ddd",
    cursor: "pointer",
    fontSize: 14,
  },
  btnDanger: {
    border: "none",
    borderRadius: 8,
    padding: "9px 14px",
    background: "#5c1a1a",
    color: "#ffb4b4",
    fontWeight: 600,
    cursor: "pointer",
    fontSize: 14,
  },
  input: {
    background: "#0a0a0a",
    border: "1px solid #333",
    borderRadius: 8,
    padding: "10px 12px",
    color: "#f2f2f2",
    fontSize: 14,
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
  },
  error: {
    background: "#2a1212",
    border: "1px solid #5c2a2a",
    color: "#ffb4b4",
    padding: "10px 12px",
    borderRadius: 8,
    marginBottom: 12,
    fontSize: 14,
  },
};
