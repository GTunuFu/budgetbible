import { db } from "@/lib/db";
import { getCategories, type Tx } from "@/lib/data";
import { prettyMerchant } from "@/lib/merchant";
import SwipeDeck, { type DeckCard } from "./SwipeDeck";

export default async function ReviewPage() {
  const sql = await db();
  const [txs, asks, cats, usage] = await Promise.all([
    sql<(Tx & { account_name: string | null })[]>`
      select t.*, coalesce(a.nickname, a.name) account_name from transactions t left join accounts a on a.id = t.account_id
      where t.review = 'inbox' and t.merged_into is null and t.status <> 'dropped'
      order by (t.possible_dup_of is null), t.purchase_date desc limit 200`,
    sql<{ merchant_key: string; label: string; amount: number; n: number; last_day: string }[]>`
      select r.merchant_key, coalesce(r.label, r.merchant_key) label,
        (select abs(amount) from transactions t where t.merchant_key = r.merchant_key order by purchase_date desc limit 1) amount,
        (select count(*)::int from transactions t where t.merchant_key = r.merchant_key) n,
        (select max(purchase_date) from transactions t where t.merchant_key = r.merchant_key) last_day
      from merchant_rules r where r.recurring = 'ask'`,
    getCategories(),
    sql<{ category: string; n: number }[]>`
      select category, count(*)::int n from transactions where category is not null and review = 'done'
        and purchase_date > now() - interval '120 days' group by category order by n desc`,
  ]);

  const dupIds = txs.map((t) => t.possible_dup_of).filter(Boolean) as string[];
  const originals = dupIds.length
    ? await sql<(Tx & { account_name: string | null })[]>`
        select t.*, coalesce(a.nickname, a.name) account_name from transactions t left join accounts a on a.id = t.account_id
        where t.id = any(${dupIds})`
    : [];
  const byId = new Map(originals.map((o) => [o.id, o]));

  const toCard = (t: Tx & { account_name: string | null }) => ({
    id: t.id, amount: t.amount, description: t.description, merchant: prettyMerchant(t.description),
    purchaseDate: t.purchase_date, postedDate: t.posted_date, status: t.status, account: t.account_name ?? "Manual entry",
    category: t.category, recurring: t.is_recurring, stupid: t.tags.includes("stupid"), source: t.source,
    merchantKey: t.merchant_key,
  });

  const cards: DeckCard[] = [];
  for (const t of txs) {
    const orig = t.possible_dup_of ? byId.get(t.possible_dup_of) : undefined;
    if (orig) cards.push({ type: "dup", key: "d" + t.id, tx: toCard(t), original: toCard(orig) });
  }
  for (const a of asks) {
    cards.push({ type: "recurring", key: "r" + a.merchant_key, merchantKey: a.merchant_key, label: a.label, amount: a.amount ?? 0, count: a.n, lastDay: a.last_day });
  }
  for (const t of txs) {
    if (t.possible_dup_of && byId.has(t.possible_dup_of)) continue;
    cards.push({ type: "tx", key: "t" + t.id, tx: toCard(t) });
  }

  const usageOrder = new Map(usage.map((u, i) => [u.category, i]));
  const categories = cats
    .map((c) => ({ name: c.name, kind: c.kind, taxable: c.taxable }))
    .sort((a, b) => (usageOrder.get(a.name) ?? 999) - (usageOrder.get(b.name) ?? 999) || a.name.localeCompare(b.name));

  return (
    <main>
      <header className="pt-1 mb-4">
        <div className="eyebrow">Review</div>
        <h1 className="text-[22px] font-semibold tracking-tight">Swipe to file</h1>
      </header>
      <SwipeDeck initial={cards} categories={categories} />
    </main>
  );
}
