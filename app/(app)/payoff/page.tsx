import Link from "next/link";
import { getAccounts, getMonthSummary, getPlan } from "@/lib/data";
import { monthOf, shiftMonth, today } from "@/lib/dates";
import { estimatedMinimum, type Debt } from "@/lib/payoff";
import Planner from "./Planner";

export default async function PayoffPage() {
  const [accounts, plan] = await Promise.all([getAccounts(), getPlan()]);
  const thisMonth = monthOf(today());
  const past = await Promise.all([1, 2, 3].map((n) => getMonthSummary(shiftMonth(thisMonth, -n))));
  const withData = past.filter((m) => m.discretionary > 0);
  const current = await getMonthSummary(thisMonth);
  const avgDiscretionary = withData.length
    ? withData.reduce((s, m) => s + m.discretionary, 0) / withData.length
    : (current.discretionary / Math.max(1, current.dayOfMonth)) * current.daysInMonth;

  const debts: (Debt & { aprKnown: boolean; minKnown: boolean })[] = accounts
    .filter((a) => !a.hidden && (a.kind === "credit" || a.kind === "loan") && a.balance < -0.5)
    .map((a) => {
      const kind = a.kind as "credit" | "loan";
      const balance = Math.abs(a.balance);
      const apr = a.apr ?? (kind === "credit" ? 24.99 : 6.5);
      return {
        id: a.id, name: a.nickname ?? a.name, balance, apr, kind,
        minPayment: a.min_payment ?? Math.round(estimatedMinimum({ balance, apr, kind })),
        aprKnown: a.apr != null, minKnown: a.min_payment != null,
      };
    });

  const debtLine = plan.fixedCosts.filter((f) => /debt|loan|card|payoff/i.test(f.name)).reduce((s, f) => s + f.amount, 0);
  const otherFixed = plan.fixedCosts.reduce((s, f) => s + f.amount, 0) - debtLine;

  return (
    <main>
      <header className="pt-1 mb-4">
        <div className="eyebrow">Payoff planner</div>
        <h1 className="text-[22px] font-semibold tracking-tight">Get to zero</h1>
      </header>
      {debts.length === 0 ? (
        <div className="card p-6 text-sm text-muted">
          No debts found. Connect SimpleFIN or <Link href="/accounts" className="text-accent underline">add a card or loan by hand</Link>.
        </div>
      ) : (
        <Planner
          debts={debts}
          income={plan.monthlyIncome}
          otherFixed={otherFixed}
          recurring={current.recurringTotal}
          avgSpending={Math.round(avgDiscretionary)}
          currentDebtPayment={debtLine}
        />
      )}
    </main>
  );
}
