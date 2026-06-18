/// <reference types="vite/client" />
import "@fontsource/inter/cyrillic-400.css";
import "@fontsource/inter/cyrillic-600.css";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-600.css";
import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./components/api";
import Layout from "./components/Layout";

const Login = lazy(() => import("./pages/Login"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Users = lazy(() => import("./pages/Users"));
const UserDetail = lazy(() => import("./pages/UserDetail"));
const Orders = lazy(() => import("./pages/Orders"));
const Esims = lazy(() => import("./pages/Esims"));
const Payments = lazy(() => import("./pages/Payments"));
const Promos = lazy(() => import("./pages/Promos"));
const Referrals = lazy(() => import("./pages/Referrals"));
const Transactions = lazy(() => import("./pages/Transactions"));
const Popular = lazy(() => import("./pages/Popular"));
const DataBrowser = lazy(() => import("./pages/DataBrowser"));

function Guard({ children }: { children: React.ReactNode }) {
  const { token, ready } = useAuth();
  if (!ready) return <div style={{ color: "#888", padding: 40 }}>Загрузка…</div>;
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function App() {
  return (
    <>
      <style>{`body{margin:0;background:#0a0a0a;color:#f2f2f2;font-family:Inter,system-ui,sans-serif}*{box-sizing:border-box}`}</style>
      <AuthProvider>
      <BrowserRouter>
        <Suspense fallback={<div style={{ color: "#888", padding: 40 }}>Загрузка…</div>}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              element={
                <Guard>
                  <Layout />
                </Guard>
              }
            >
              <Route index element={<Dashboard />} />
              <Route path="users" element={<Users />} />
              <Route path="users/:id" element={<UserDetail />} />
              <Route path="orders" element={<Orders />} />
              <Route path="esims" element={<Esims />} />
              <Route path="payments" element={<Payments />} />
              <Route path="promos" element={<Promos />} />
              <Route path="referrals" element={<Referrals />} />
              <Route path="transactions" element={<Transactions />} />
              <Route path="popular" element={<Popular />} />
              <Route path="data" element={<DataBrowser />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
