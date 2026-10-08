import Link from "next/link";
import { getCategories, getMonthSummary, getPlan, money } from "@/lib/data";
import { addCategory, logout, saveBudgets } from "@/app/actions";
import PlanForm from "./PlanForm";

export default async function SettingsPage() {
  const [plan, cats, m] = await Promise.all([getPlan(), getCategories(), getMonthSummary()]);
  const spendCats = cats.filter((c) => c.kind === "spend");
  const budgeted = spendCats.reduce((s, c) => s + c.budget, 0);
  const allowance = plan.monthlyIncome - plan.fixedCosts.reduce((s, f) => s + f.amount, 0) - m.recurringTotal;

  return (
    <main className="space-y-4">
      <header className="pt-1">
        <Link href="/" className="text-sm text-muted">‹ Home</Link>
        <h1 className="text-[22px] font-semibold tracking-tight mt-1">Your plan</h1>
      </header>

      <PlanForm plan={plan} />

      <section className="card p-4">
        <div className="flex justify-between items-baseline mb-1">
          <div className="eyebrow">Category budgets</div>
          <div className={`text-xs num ${budgeted > allowance ? "text-bad" : "text-muted"}`}>
            {money(budgeted, { cents: false })} of {money(allowance, { cents: false })} allowance
          </div>
        </div>
        <p className="text-xs text-muted mb-3">Optional monthly caps. Leave at 0 to just track.</p>
        <form action={saveBudgets} className="space-y-2">
          {spendCats.map((c) => (
            <label key={c.name} className="flex items-center justify-between gap-3 text-sm">
              <span>{c.name}</span>
              <span className="flex items-center gap-1 text-muted">$
                <input name={`budget:${c.name}`} inputMode="decimal" defaultValue={c.budget || ""} placeholder="0"
                  className="w-24 text-right field !py-1.5 !text-[15px]" />
              </span>
            </label>
          ))}
          <button className="btn w-full !mt-4">Save budgets</button>
        </form>
        <form action={addCategory} className="flex gap-2 mt-4 pt-4 border-t border-line">
          <input name="name" className="field" placeholder="New category, e.g. Personal - Gym" />
          <button className="btn btn-ghost shrink-0">Add</button>
        </form>
      </section>

      <section className="card p-4 text-sm space-y-3">
        <div className="eyebrow">How dates work</div>
        <p className="text-muted">
          Every purchase counts on the day you <b className="text-ink">bought</b> it. When the bank processes it days later, the app links the
          posted version to the original pending one, so nothing moves to May 9 when you spent it on May 7. If a match is uncertain,
          you get a &ldquo;Same purchase?&rdquo; card.
        </p>
      </section>

      <form action={logout} className="text-center pb-4">
        <button className="text-sm text-muted underline">Log out</button>
      </form>
    </main>
  );
}
