import "server-only";
import { db, getSetting } from "./db";
import { monthBounds, today, monthOf } from "./dates";

export type FixedCost = { name: string; amount: number };
export type Plan = { monthlyIncome: number; payFrequency: "monthly" | "biweekly" | "semimonthly"; fixedCosts: FixedCost[] };

export const DEFAULT_PLAN: Plan = {
  monthlyIncome: 0,
  payFrequency: "monthly",
  fixedCosts: [
    { name: "Rent", amount: 0 },
    { name: "Utilities", amount: 0 },
    { name: "Monthly Debt Contributions", amount: 0 },
  ],
};

export async function getPlan(): Promise<Plan> {
  return { ...DEFAULT_PLAN, ...(await getSetting<Partial<Plan>>("plan", {})) };
}

export type Account = {
  id: string; source: string; org_name: string | null; name: string; nickname: string | null; kind: string;
  balance: number; available: number | null; balance_date: Date | null; apr: number | null; min_payment: number | null;
  hidden: boolean;
};

export async function getAccounts() {
  const sql = await db();
  return sql<Account[]>`select * from accounts order by
    case kind when 'checking' then 1 when 'savings' then 2 when 'credit' then 3 when 'loan' then 4 else 5 end, name`;
}

export type Category = { name: string; grp: string; budget: number; sort: number; kind: string };
export async function getCategories() {
  const sql = await db();
  return sql<Category[]>`select * from categories order by sort, name`;
}

export type Tx = {
  id: string; account_id: string | null; amount: number; description: string; merchant_key: string;
  purchase_date: string; posted_date: string | null; status: string; category: string | null; tags: string[];
  is_recurring: boolean; is_transfer: boolean; review: string; source: string; possible_dup_of: string | null;
  notes: string | null; account_name?: string | null;
};

export type RecurringItem = { merchant_key: string; label: string; amount: number; lastDay: string; chargedThisMonth: boolean };

export async function getRecurring(month: string): Promise<RecurringItem[]> {
  const sql = await db();
  const { start, next } = monthBounds(month);
  const rows = await sql<{ merchant_key: string; label: string; amount: number; last_day: string; this_month: boolean }[]>`
    select r.merchant_key, coalesce(r.label, r.merchant_key) label,
      (select abs(amount) from transactions t where t.merchant_key = r.merchant_key and t.merged_into is null
        and t.status <> 'dropped' order by purchase_date desc limit 1) amount,
      (select max(purchase_date) from transactions t where t.merchant_key = r.merchant_key) last_day,
      exists(select 1 from transactions t where t.merchant_key = r.merchant_key and t.merged_into is null
        and t.status <> 'dropped' and t.purchase_date >= ${start} and t.purchase_date < ${next}) this_month
    from merchant_rules r where r.recurring = 'yes' order by label`;
  return rows.map((r) => ({
    merchant_key: r.merchant_key, label: r.label, amount: r.amount ?? 0, lastDay: r.last_day, chargedThisMonth: r.this_month,
  }));
}

export type MonthSummary = {
  month: string;
  plannedIncome: number;
  actualIncome: number;
  fixedTotal: number;
  recurringTotal: number;
  allowance: number; // income - fixed - recurring
  discretionary: number; // spent this month outside fixed & recurring
  recurringSpent: number;
  safeToSpend: number;
  perDayLeft: number;
  dayOfMonth: number;
  daysInMonth: number;
  pendingTotal: number;
  pendingCount: number;
  byCategory: { name: string; grp: string; spent: number; budget: number; count: number }[];
  uncategorized: number;
};

export async function getMonthSummary(month = monthOf(today())): Promise<MonthSummary> {
  const sql = await db();
  const plan = await getPlan();
  const { start, next, days } = monthBounds(month);
  const cats = await getCategories();
  const kindOf = new Map(cats.map((c) => [c.name, c.kind]));
  const txs = await sql<Tx[]>`
    select * from transactions where purchase_date >= ${start} and purchase_date < ${next}
      and merged_into is null and status <> 'dropped' and not is_transfer`;
  const recurring = await getRecurring(month);

  let actualIncome = 0, discretionary = 0, recurringSpent = 0, pendingTotal = 0, pendingCount = 0, uncategorized = 0;
  const byCat = new Map<string, { spent: number; count: number }>();
  for (const t of txs) {
    if (t.possible_dup_of) continue; // waiting on a "Same purchase?" answer; don't double count
    const kind = t.category ? kindOf.get(t.category) ?? "spend" : "spend";
    if (kind === "transfer") continue;
    if (kind === "income") { actualIncome += t.amount; continue; }
    const spend = -t.amount; // refunds come through as negative spend
    if (t.status === "pending" && t.amount < 0) { pendingTotal += spend; pendingCount++; }
    const key = t.category ?? "Uncategorized";
    const c = byCat.get(key) ?? { spent: 0, count: 0 };
    c.spent += spend; c.count++;
    byCat.set(key, c);
    if (!t.category) uncategorized++;
    if (kind === "fixed") continue;
    if (t.is_recurring) recurringSpent += spend;
    else discretionary += spend;
  }

  const fixedTotal = plan.fixedCosts.reduce((s, f) => s + (Number(f.amount) || 0), 0);
  const recurringTotal = recurring.reduce((s, r) => s + r.amount, 0);
  const plannedIncome = plan.monthlyIncome || actualIncome;
  const allowance = plannedIncome - fixedTotal - recurringTotal;
  const safeToSpend = allowance - discretionary;
  const isCurrent = month === monthOf(today());
  const dayOfMonth = isCurrent ? Number(today().slice(8, 10)) : days;
  const daysLeft = Math.max(1, days - dayOfMonth + 1);

  const byCategory = [...byCat.entries()]
    .map(([name, v]) => {
      const c = cats.find((x) => x.name === name);
      return { name, grp: c?.grp ?? "Other", spent: v.spent, budget: c?.budget ?? 0, count: v.count };
    })
    .sort((a, b) => b.spent - a.spent);

  return {
    month, plannedIncome, actualIncome, fixedTotal, recurringTotal, allowance, discretionary, recurringSpent,
    safeToSpend, perDayLeft: safeToSpend / daysLeft, dayOfMonth, daysInMonth: days, pendingTotal, pendingCount,
    byCategory, uncategorized,
  };
}

export async function getInboxCount() {
  const sql = await db();
  const [{ n }] = await sql<{ n: number }[]>`
    select (select count(*) from transactions where review = 'inbox' and merged_into is null and status <> 'dropped')
         + (select count(*) from merchant_rules where recurring = 'ask') as n`;
  return Number(n);
}

export { money } from "./format";
