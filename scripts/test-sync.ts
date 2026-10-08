// Offline test of the sync/matching engine against a local Postgres.
// Run: DATABASE_URL=postgres://postgres@127.0.0.1:5433/bb npx tsx --conditions=react-server scripts/test-sync.ts
import { ingest } from "../lib/sync";
import { db } from "../lib/db";
import { getMonthSummary } from "../lib/data";

const ts = (day: string) => Math.floor(Date.parse(day + "T16:00:00Z") / 1000);
const tx = (id: string, desc: string, amount: number, day: string, pending = false, postedDay?: string) => ({
  id, description: desc, amount: String(amount), transacted_at: ts(day),
  posted: pending ? 0 : ts(postedDay ?? day), pending,
});

async function main() {
  const sql = await db();
  await sql`truncate transactions, accounts, merchant_rules, balance_snapshots, sync_log, settings cascade`;

  // ---- Sync #1
  await ingest({
    connections: [{ conn_id: "c1", name: "SoFi" }, { conn_id: "c2", name: "Chase" }],
    accounts: [
      { id: "sofi-chk", name: "SoFi Checking", conn_id: "c1", currency: "USD", balance: "1670.80", "balance-date": ts("2026-10-05"),
        transactions: [
          tx("p1", "OKIE POKII CAFE NEW YORK NY", -41.17, "2026-10-04", true),
          tx("p2", "SHELL OIL 57444 JERSEY CITY NJ", -1.0, "2026-10-04", true),
          tx("t1", "NJ TRANSIT 1234", -34, "2026-10-03"),
          tx("t2", "ROKT PAYROLL DIR DEP", 2697, "2026-10-01"),
          tx("t3", "CHASE CREDIT CRD AUTOPAY", -500, "2026-10-02"),
        ] },
      { id: "chase-prime", name: "Prime Visa", conn_id: "c2", currency: "USD", balance: "-10337.51", "balance-date": ts("2026-10-05"),
        transactions: [
          tx("s1", "SPOTIFY USA", -14.06, "2026-08-07"),
          tx("s2", "SPOTIFY USA", -14.06, "2026-09-07"),
          tx("s3", "SPOTIFY USA", -14.06, "2026-10-07", false),
          tx("c1", "Payment Thank You-Mobile", 500, "2026-10-03"),
          tx("c2", "PURCHASE INTEREST CHARGE", -260, "2026-09-28"),
          tx("w1", "NY WATERWAY 0423 WEEHAWKEN NJ", -8.25, "2026-10-02"),
          tx("w2", "NY WATERWAY 0424 WEEHAWKEN NJ", -8.25, "2026-10-03"),
        ] },
    ],
  });

  // user logs two purchases by hand
  await sql`insert into transactions (account_id, amount, description, merchant_key, purchase_date, status, category, review, source)
    values ('sofi-chk', -47.68, 'Pho Today', 'pho today', '2026-10-05', 'pending', 'FoodBev', 'done', 'manual'),
           ('sofi-chk', -29.11, 'Lunch with Anika', 'lunch with anika', '2026-10-06', 'pending', 'FoodBev', 'done', 'manual')`;

  // ---- Sync #2: pendings post (with tip / final gas amount), manual entries get bank versions
  const s2 = await ingest({
    accounts: [
      { id: "sofi-chk", name: "SoFi Checking", conn_id: "c1", currency: "USD", balance: "1400.00", "balance-date": ts("2026-10-08"),
        transactions: [
          tx("t1", "NJ TRANSIT 1234", -34, "2026-10-03"),
          tx("x1", "OKIE POKII CAFE", -49.17, "2026-10-04", false, "2026-10-06"),
          tx("x2", "SHELL OIL 57444 JERSEY CITY NJ", -39.88, "2026-10-04", false, "2026-10-06"),
          tx("x3", "PHO TODAY NYC", -47.68, "2026-10-05", false, "2026-10-07"),
          tx("x4", "SALTY LUNCH LADYS", -29.11, "2026-10-06", false, "2026-10-07"),
        ] },
    ],
  });
  console.log("sync2", s2);

  const rows = await sql`select description, amount, purchase_date, posted_date, status, category, is_transfer, review, source,
    possible_dup_of is not null as dup_q, external_id, alt_ids from transactions order by purchase_date, description`;
  console.table(rows.map((r) => ({ ...r, alt_ids: r.alt_ids.join(",") })));
  console.log(await sql`select merchant_key, recurring from merchant_rules where recurring <> 'unknown'`);
  const m = await getMonthSummary("2026-10");
  console.log({ discretionary: m.discretionary, pending: m.pendingTotal, actualIncome: m.actualIncome, cats: m.byCategory });
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
