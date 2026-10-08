import "server-only";
import { db, getSetting } from "./db";
import { monthBounds, monthLabel, shiftMonth, today, monthOf } from "./dates";

export type FixedCost = { name: string; amount: number };
export type IncomeMode = "last_month" | "avg3" | "lowest6" | "manual";
export type Plan = {
  incomeMode: IncomeMode;
  manualIncome: number; // baseline you're confident in (used for "manual", and as a fallback before there's history)
  taxPct: number; // % of untaxed (1099) income to set aside
  fixedCosts: FixedCost[];
};

export const DEFAULT_PLAN: Plan = {
  incomeMode: "avg3",
  manualIncome: 0,
  taxPct: 25,
  fixedCosts: [
    { name: "Rent", amount: 0 },
    { name: "Utilities", amount: 0 },
    { name: "Monthly Debt Contributions", amount: 0 },
  ],
};

export async function getPlan(): Promise<Plan> {
  const saved = await getSetting<Partial<Plan> & { monthlyIncome?: number }>("plan", {});
  const plan = { ...DEFAULT_PLAN, ...saved };
  if (!saved.manualIncome && saved.monthlyIncome) plan.manualIncome = saved.monthlyIncome; // older saves
  return plan;
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

export type Category = { name: string; grp: string; budget: number; sort: number; kind: string; taxable: boolean };
export async function getCategories() {
  const sql = await db();
  return sql<Category[]>`select * from categories order by kind = 'transfer', kind, name`;
}

type MonthTotals = { income: number; taxable: number; discretionary: number };

/** Per-month income and everyday spending, by purchase date. */
export async function monthlyTotals(fromMonth: string, toMonthExclusive: string) {
  const sql = await db();
  const rows = await sql<{ month: string; income: number; taxable: number; discretionary: number }[]>`
    select to_char(t.purchase_date, 'YYYY-MM') as month,
      coalesce(sum(t.amount) filter (where c.kind = 'income'), 0)::numeric as income,
      coalesce(sum(t.amount) filter (where c.kind = 'income' and c.taxable), 0)::numeric as taxable,
      coalesce(sum(-t.amount) filter (where coalesce(c.kind, 'spend') = 'spend' and not t.is_recurring), 0)::numeric as discretionary
    from transactions t left join categories c on c.name = t.category
    where t.purchase_date >= ${fromMonth + "-01"} and t.purchase_date < ${toMonthExclusive + "-01"}
      and t.merged_into is null and t.status <> 'dropped' and not t.is_transfer and t.possible_dup_of is null
    group by 1`;
  const out = new Map<string, MonthTotals>();
  for (const r of rows) out.set(r.month, { income: r.income, taxable: r.taxable, discretionary: r.discretionary });
  return out;
}

async function firstDataMonth() {
  const sql = await db();
  const [r] = await sql<{ d: string | null }[]>`select min(purchase_date)::text d from transactions where merged_into is null`;
  return r?.d ? r.d.slice(0, 7) : null;
}

export type IncomePicture = {
  planningIncome: number; // after tax set-aside
  basis: string; // human explanation
  history: { month: string; net: number; gross: number }[]; // newest first, full months only
  avgDiscretionary: number;
};

/** Works out what income to plan a month around when pay is irregular. */
export async function getIncomePicture(month: string, plan: Plan): Promise<IncomePicture> {
  const first = await firstDataMonth();
  const prior = [1, 2, 3, 4, 5, 6].map((n) => shiftMonth(month, -n));
  const totals = await monthlyTotals(prior[5], month);
  // only count months fully covered by your data (SimpleFIN goes back ~90 days)
  const covered = prior.filter((m) => first && m > first);
  const history = covered.map((m) => {
    const t = totals.get(m) ?? { income: 0, taxable: 0, discretionary: 0 };
    return { month: m, gross: t.income, net: t.income - (t.taxable * plan.taxPct) / 100 };
  });
  const spendMonths = covered.slice(0, 3).map((m) => totals.get(m)?.discretionary ?? 0);
  const avgDiscretionary = spendMonths.length ? spendMonths.reduce((a, b) => a + b, 0) / spendMonths.length : 0;

  const fallback = (why: string): IncomePicture => ({
    planningIncome: plan.manualIncome,
    basis: plan.manualIncome ? `your baseline (${why})` : `nothing yet (${why}); set a baseline in Settings`,
    history, avgDiscretionary,
  });

  if (plan.incomeMode === "manual") return { planningIncome: plan.manualIncome, basis: "your baseline", history, avgDiscretionary };
  if (!history.length) return fallback("not enough history");
  const lbl = (m: string) => monthLabel(m).split(" ")[0];
  if (plan.incomeMode === "last_month") {
    return { planningIncome: history[0].net, basis: `what you earned in ${lbl(history[0].month)}`, history, avgDiscretionary };
  }
  if (plan.incomeMode === "lowest6") {
    const low = history.reduce((a, b) => (b.net < a.net ? b : a));
    return { planningIncome: low.net, basis: `your leanest month (${lbl(low.month)})`, history, avgDiscretionary };
  }
  const last3 = history.slice(0, 3);
  if (last3.length === 1) {
    return { planningIncome: last3[0].net, basis: `${lbl(last3[0].month)} (only full month so far)`, history, avgDiscretionary };
  }
  return {
    planningIncome: last3.reduce((s, h) => s + h.net, 0) / last3.length,
    basis: `your ${last3.length}-month average`,
    history, avgDiscretionary,
  };
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
  plannedIncome: number; // what this month is budgeted around (after tax set-aside)
  incomeBasis: string;
  actualIncome: number; // earned so far this month (gross)
  taxSetAside: number; // this month
  avgDiscretionary: number;
  monthlyBurn: number; // fixed + recurring + typical everyday spending
  incomeHistory: { month: string; net: number; gross: number }[];
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

  let taxable = 0;
  let actualIncome = 0, discretionary = 0, recurringSpent = 0, pendingTotal = 0, pendingCount = 0, uncategorized = 0;
  const byCat = new Map<string, { spent: number; count: number }>();
  for (const t of txs) {
    if (t.possible_dup_of) continue; // waiting on a "Same purchase?" answer; don't double count
    const kind = t.category ? kindOf.get(t.category) ?? "spend" : "spend";
    if (kind === "transfer") continue;
    if (kind === "income") {
      actualIncome += t.amount;
      if (cats.find((c) => c.name === t.category)?.taxable) taxable += t.amount;
      continue;
    }
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
  const pic = await getIncomePicture(month, plan);
  const taxSetAside = (taxable * plan.taxPct) / 100;
  // never plan on less than you've already brought in this month
  const plannedIncome = Math.max(pic.planningIncome, actualIncome - taxSetAside);
  const incomeBasis = plannedIncome > pic.planningIncome ? "what you've earned so far this month" : pic.basis;
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
    month, plannedIncome, incomeBasis, actualIncome, taxSetAside, avgDiscretionary: pic.avgDiscretionary,
    monthlyBurn: fixedTotal + recurringTotal + (pic.avgDiscretionary || (discretionary / Math.max(1, dayOfMonth)) * days),
    incomeHistory: pic.history, fixedTotal, recurringTotal, allowance, discretionary, recurringSpent,
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
