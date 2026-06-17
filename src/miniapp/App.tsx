/// <reference types="vite/client" />
import "@fontsource/inter/cyrillic-400.css";
import "@fontsource/inter/cyrillic-600.css";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-600.css";
import { StrictMode, Suspense, lazy, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useSearchParams,
} from "react-router-dom";
import {
  AccountProvider,
  AuthGate,
  I18nProvider,
  ThemeProvider,
} from "./components/i18n";

const Home = lazy(() => import("./pages/Home"));
const Catalog = lazy(() => import("./pages/Catalog"));
const Detail = lazy(() => import("./pages/Detail"));
const MyEsims = lazy(() => import("./pages/MyEsims"));
const Referral = lazy(() => import("./pages/Referral"));
const Replenishment = lazy(() => import("./pages/Replenishment"));
const Settings = lazy(() => import("./pages/Settings"));
const EsimDetail = lazy(() => import("./pages/EsimDetail"));
const Payment = lazy(() => import("./pages/Payment"));

function ScrollTop() {
  const { pathname, search } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname, search]);
  return null;
}

function BuyPage() {
  const [params] = useSearchParams();
  const region = params.get("region");
  const [country, setCountry] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (!region) {
      setCountry(undefined);
      return;
    }
    import("@assets/catalog").then(({ countryByCode, isCountryProduct }) => {
      const name = countryByCode(region);
      setCountry(name && isCountryProduct(name) ? name : null);
    });
  }, [region]);

  if (region) {
    if (country === undefined) return null;
    if (!country) return <Navigate to="/buy" replace />;
    return (
      <Suspense fallback={null}>
        <Detail country={country} />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={null}>
      <Catalog />
    </Suspense>
  );
}

function AppRoutes() {
  const location = useLocation();
  return (
    <div key={`${location.pathname}${location.search}`} className="page-transition">
      <Routes location={location}>
        <Route
          path="/"
          element={
            <Suspense fallback={null}>
              <Home />
            </Suspense>
          }
        />
        <Route path="/buy" element={<BuyPage />} />
        <Route
          path="/myesims"
          element={
            <AuthGate>
              <Suspense fallback={null}>
                <MyEsims />
              </Suspense>
            </AuthGate>
          }
        />
        <Route
          path="/referral"
          element={
            <AuthGate>
              <Suspense fallback={null}>
                <Referral />
              </Suspense>
            </AuthGate>
          }
        />
        <Route
          path="/replenishment"
          element={
            <AuthGate>
              <Suspense fallback={null}>
                <Replenishment />
              </Suspense>
            </AuthGate>
          }
        />
        <Route
          path="/settings"
          element={
            <AuthGate>
              <Suspense fallback={null}>
                <Settings />
              </Suspense>
            </AuthGate>
          }
        />
        <Route
          path="/esim/:id"
          element={
            <AuthGate>
              <Suspense fallback={null}>
                <EsimDetail />
              </Suspense>
            </AuthGate>
          }
        />
        <Route
          path="/payment"
          element={
            <AuthGate>
              <Suspense fallback={null}>
                <Payment />
              </Suspense>
            </AuthGate>
          }
        />
        <Route path="/orders" element={<Navigate to="/referral" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}

function App() {
  return (
    <ThemeProvider>
      <I18nProvider>
        <AccountProvider>
          <BrowserRouter>
            <ScrollTop />
            <AppRoutes />
          </BrowserRouter>
        </AccountProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
