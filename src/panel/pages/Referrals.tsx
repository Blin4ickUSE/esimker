import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatUsd, type ReferralStats } from "../components/api";
import { Card, ErrorBox, Page, TableWrap, Td, Th } from "../components/ui";

export default function Referrals() {
  const [data, setData] = useState<ReferralStats | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.referrals().then(setData).catch((e) => setError(e.message));
  }, []);

  return (
    <Page title="Реферальная программа">
      {error && <ErrorBox text={error} />}
      {data && (
        <>
          <Card style={{ marginBottom: 16 }}>
            <h3 style={{ marginTop: 0 }}>Топ рефереров</h3>
            <TableWrap>
              <thead>
                <tr>
                  <Th>ID</Th>
                  <Th>Telegram</Th>
                  <Th>Код</Th>
                  <Th>Приглашено</Th>
                  <Th>Заработано</Th>
                </tr>
              </thead>
              <tbody>
                {data.topReferrers.map((r) => (
                  <tr key={String(r.id)}>
                    <Td>
                      <Link to={`/users/${r.id}`} style={{ color: "#ff8c1a" }}>
                        #{String(r.id)}
                      </Link>
                    </Td>
                    <Td>{String(r.telegram_id)}</Td>
                    <Td>{String(r.referral_code)}</Td>
                    <Td>{String(r.referral_count)}</Td>
                    <Td>{formatUsd(Number(r.referral_earned_usd))}</Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </Card>
          <Card>
            <h3 style={{ marginTop: 0 }}>Последние начисления</h3>
            <TableWrap>
              <thead>
                <tr>
                  <Th>Реферер</Th>
                  <Th>Заказ</Th>
                  <Th>Комиссия</Th>
                  <Th>Дата</Th>
                </tr>
              </thead>
              <tbody>
                {data.recentEarnings.map((e, i) => (
                  <tr key={i}>
                    <Td>{String(e.referrer_telegram_id)}</Td>
                    <Td>{String(e.order_id)}</Td>
                    <Td>{formatUsd(Number(e.commission_usd))}</Td>
                    <Td>{String(e.created_at)}</Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </Card>
        </>
      )}
    </Page>
  );
}
