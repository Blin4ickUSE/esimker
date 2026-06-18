import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatUsd, type DashboardStats } from "../components/api";
import { Card, ErrorBox, Page, StatGrid, TableWrap, Td, Th } from "../components/ui";

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.stats().then(setStats).catch((e) => setError(e.message));
  }, []);

  return (
    <Page title="Обзор">
      {error && <ErrorBox text={error} />}
      {stats && (
        <>
          <StatGrid
            items={[
              { label: "Пользователи", value: String(stats.users), hint: `заблокировано: ${stats.blockedUsers}` },
              { label: "Заказы", value: String(stats.orders), hint: `сегодня: ${stats.ordersToday}` },
              { label: "Выручка", value: formatUsd(stats.revenueUsd), hint: `сегодня: ${formatUsd(stats.revenueTodayUsd)}` },
              { label: "eSIM", value: String(stats.esims) },
              { label: "Балансы", value: formatUsd(stats.balanceTotalUsd) },
              { label: "Ожидают оплаты", value: String(stats.pendingPayments) },
              { label: "Реф. выплаты", value: formatUsd(stats.referralPaidUsd) },
            ]}
          />
          <Card>
            <h2 style={{ margin: "0 0 12px", fontSize: 16 }}>Топ стран по выручке</h2>
            <TableWrap>
              <thead>
                <tr>
                  <Th>Страна</Th>
                  <Th>Заказов</Th>
                  <Th>Выручка</Th>
                </tr>
              </thead>
              <tbody>
                {stats.topCountries.map((c) => (
                  <tr key={c.country_code}>
                    <Td>{c.country_code}</Td>
                    <Td>{c.orders_count}</Td>
                    <Td>{formatUsd(Number(c.revenue_usd))}</Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </Card>
          <div style={{ marginTop: 16, fontSize: 13, color: "#666" }}>
            <Link to="/users" style={{ color: "#ff8c1a" }}>Пользователи</Link>
            {" · "}
            <Link to="/orders" style={{ color: "#ff8c1a" }}>Заказы</Link>
            {" · "}
            <Link to="/data" style={{ color: "#ff8c1a" }}>Просмотр БД</Link>
          </div>
        </>
      )}
    </Page>
  );
}
