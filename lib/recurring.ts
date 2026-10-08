import "server-only";
import { db } from "./db";
import { addDays, diffDays, today } from "./dates";

/**
 * Finds merchants that charge about the same amount roughly monthly and flags
 * them as "ask" so the Review screen can show an "Is this recurring?" card.
 */
export async function detectRecurring() {
  const sql = await db();
  const rows = await sql<{ merchant_key: string; amount: number; purchase_date: string }[]>`
    select t.merchant_key, t.amount, t.purchase_date from transactions t
    join merchant_rules r on r.merchant_key = t.merchant_key
    where r.recurring = 'unknown' and t.amount < 0 and not t.is_transfer
      and t.merged_into is null and t.status <> 'dropped'
      and t.purchase_date >= ${addDays(today(), -130)}
    order by t.merchant_key, t.purchase_date`;
  const groups = new Map<string, { amount: number; day: string }[]>();
  for (const r of rows) {
    if (!r.merchant_key) continue;
    const g = groups.get(r.merchant_key) ?? [];
    g.push({ amount: Math.abs(r.amount), day: r.purchase_date });
    groups.set(r.merchant_key, g);
  }
  const flagged: string[] = [];
  for (const [key, list] of groups) {
    if (isMonthly(list)) flagged.push(key);
  }
  if (flagged.length) {
    await sql`update merchant_rules set recurring = 'ask', updated_at = now()
              where merchant_key = any(${flagged}) and recurring = 'unknown'`;
  }
  return flagged.length;
}

export function isMonthly(list: { amount: number; day: string }[]) {
  if (list.length < 2) return false;
  const months = new Set(list.map((x) => x.day.slice(0, 7)));
  if (months.size < 2 || list.length > months.size + 1) return false; // frequent spends (coffee, MTA) aren't subscriptions
  const amounts = list.map((x) => x.amount).sort((a, b) => a - b);
  const median = amounts[Math.floor(amounts.length / 2)];
  if (!amounts.every((a) => Math.abs(a - median) <= Math.max(1, median * 0.15))) return false;
  for (let i = 1; i < list.length; i++) {
    const gap = diffDays(list[i].day, list[i - 1].day);
    if (gap < 24 || gap > 38) return false;
  }
  return true;
}
