// Pure debt-payoff math, shared by server and client.

export type Debt = {
  id: string;
  name: string;
  balance: number; // amount owed, positive
  apr: number; // percent, e.g. 24.99
  minPayment: number; // monthly minimum
  kind: "credit" | "loan";
};

/** Monthly payment that clears `balance` in exactly `months` at `apr`%. */
export function paymentForMonths(balance: number, apr: number, months: number) {
  if (balance <= 0) return 0;
  const r = apr / 100 / 12;
  if (r === 0) return balance / months;
  return (balance * r) / (1 - Math.pow(1 + r, -months));
}

export function estimatedMinimum(d: Pick<Debt, "balance" | "apr" | "kind">) {
  if (d.balance <= 0) return 0;
  if (d.kind === "loan") return Math.max(50, paymentForMonths(d.balance, d.apr || 6, 120));
  // typical card minimum: 1% of balance + that month's interest, at least $35
  return Math.max(35, d.balance * 0.01 + (d.balance * (d.apr || 24)) / 1200);
}

export type SimResult = {
  feasible: boolean;
  months: number;
  totalInterest: number;
  totalPaid: number;
  payoffMonth: Record<string, number>;
  balances: number[]; // total balance at the end of each month (index 0 = today)
};

/**
 * Simulate paying `monthly` dollars per month across all debts.
 * Everyone gets their minimum; the extra goes to the highest APR (avalanche)
 * or the smallest balance (snowball). Freed-up minimums roll forward.
 */
export function simulate(debts: Debt[], monthly: number, strategy: "avalanche" | "snowball" = "avalanche"): SimResult {
  const live = debts.filter((d) => d.balance > 0.005).map((d) => ({ ...d }));
  const payoffMonth: Record<string, number> = {};
  const balances = [live.reduce((s, d) => s + d.balance, 0)];
  let totalInterest = 0;
  let totalPaid = 0;
  const minTotal = live.reduce((s, d) => s + Math.min(d.minPayment, d.balance), 0);
  if (!live.length) return { feasible: true, months: 0, totalInterest: 0, totalPaid: 0, payoffMonth, balances };
  if (monthly < minTotal - 0.01) {
    return { feasible: false, months: Infinity, totalInterest: Infinity, totalPaid: Infinity, payoffMonth, balances };
  }

  for (let m = 1; m <= 600; m++) {
    for (const d of live) {
      if (d.balance <= 0) continue;
      const interest = (d.balance * d.apr) / 1200;
      d.balance += interest;
      totalInterest += interest;
    }
    let budget = monthly;
    for (const d of live) {
      if (d.balance <= 0) continue;
      const pay = Math.min(d.minPayment, d.balance, budget);
      d.balance -= pay; budget -= pay; totalPaid += pay;
    }
    const order = live
      .filter((d) => d.balance > 0)
      .sort((a, b) => (strategy === "avalanche" ? b.apr - a.apr || a.balance - b.balance : a.balance - b.balance));
    for (const d of order) {
      if (budget <= 0) break;
      const pay = Math.min(d.balance, budget);
      d.balance -= pay; budget -= pay; totalPaid += pay;
    }
    for (const d of live) {
      if (d.balance <= 0.005 && payoffMonth[d.id] == null) { d.balance = 0; payoffMonth[d.id] = m; }
    }
    const total = live.reduce((s, d) => s + Math.max(0, d.balance), 0);
    balances.push(total);
    if (total <= 0.005) return { feasible: true, months: m, totalInterest, totalPaid, payoffMonth, balances };
    if (m > 24 && total >= balances[m - 12]) break; // not shrinking
  }
  return { feasible: false, months: Infinity, totalInterest, totalPaid, payoffMonth, balances };
}

/** Smallest monthly amount that clears everything within `months` (binary search over simulate). */
export function monthlyNeededFor(debts: Debt[], months: number, strategy: "avalanche" | "snowball" = "avalanche") {
  const total = debts.reduce((s, d) => s + Math.max(0, d.balance), 0);
  if (total <= 0) return 0;
  let lo = debts.reduce((s, d) => s + Math.min(d.minPayment, d.balance), 0);
  let hi = debts.reduce((s, d) => s + paymentForMonths(d.balance, d.apr, months), 0) + 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const r = simulate(debts, mid, strategy);
    if (r.feasible && r.months <= months) hi = mid;
    else lo = mid;
  }
  return Math.ceil(hi);
}
