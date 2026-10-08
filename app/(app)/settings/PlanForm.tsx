"use client";
import { useState, useTransition } from "react";
import { savePlan } from "@/app/actions";
import type { IncomeMode, Plan } from "@/lib/data";
import { money } from "@/lib/format";

const MODES: { v: IncomeMode; label: string; help: string }[] = [
  { v: "avg3", label: "3-month average", help: "Smooths out big and small months. A good default." },
  { v: "last_month", label: "Last month's income", help: "Spend this month only what you earned last month. Never spends money you don't have yet." },
  { v: "lowest6", label: "Leanest month", help: "Plans around your worst recent month. Most cautious." },
  { v: "manual", label: "A number I set", help: "Use the baseline below, e.g. a guaranteed stipend or retainer." },
];

export default function PlanForm({ plan, preview }: { plan: Plan; preview: Partial<Record<IncomeMode, number>> }) {
  const [rows, setRows] = useState(plan.fixedCosts.length ? plan.fixedCosts : [{ name: "", amount: 0 }]);
  const [mode, setMode] = useState<IncomeMode>(plan.incomeMode);
  const [baseline, setBaseline] = useState(plan.manualIncome || 0);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const fixed = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);

  return (
    <form
      action={(fd) => start(async () => { await savePlan(fd); setSaved(true); setTimeout(() => setSaved(false), 2000); })}
      className="card p-4 space-y-5"
    >
      <div>
        <div className="eyebrow mb-1">Income</div>
        <p className="text-xs text-muted mb-3">
          Your pay changes month to month, so the budget is built from deposits you&apos;ve actually filed under an
          <b className="text-ink"> income</b> category (e.g. &ldquo;Income - Freelance&rdquo;, &ldquo;Income - Startup&rdquo;). Pick what each month should be planned around:
        </p>
        <input type="hidden" name="income_mode" value={mode} />
        <div className="space-y-2">
          {MODES.map((m) => (
            <button type="button" key={m.v} onClick={() => setMode(m.v)}
              className={`w-full text-left rounded-xl border px-3 py-2.5 ${mode === m.v ? "border-ink bg-paper" : "border-line"}`}>
              <div className="flex justify-between items-baseline">
                <span className="font-medium text-[15px]">{m.label}</span>
                <span className="num text-sm text-muted">
                  {m.v === "manual" ? money(baseline, { cents: false }) : preview[m.v] != null ? money(preview[m.v]!, { cents: false }) : "needs history"}
                </span>
              </div>
              <div className="text-xs text-muted mt-0.5">{m.help}</div>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3 mt-4">
          <label className="block"><span className="text-xs text-muted block mb-1">Baseline income / mo</span>
            <input name="manual_income" inputMode="decimal" className="field" value={baseline || ""} placeholder="0"
              onChange={(e) => setBaseline(Number(e.target.value) || 0)} />
          </label>
          <label className="block"><span className="text-xs text-muted block mb-1">Tax set-aside %</span>
            <input name="tax_pct" inputMode="decimal" className="field" defaultValue={plan.taxPct} />
          </label>
        </div>
        <p className="text-xs text-muted mt-2">
          The baseline is also used until the app has a full month of history. The tax set-aside is taken off income in categories marked
          &ldquo;taxes not withheld&rdquo; (freelance / 1099) before it counts as spendable.
        </p>
      </div>

      <div className="pt-4 border-t border-line">
        <div className="eyebrow mb-2">Monthly bills</div>
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="flex gap-2">
              <input name="fixed_name" className="field" value={r.name} placeholder="Rent"
                onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <input name="fixed_amount" inputMode="decimal" className="field !w-28 text-right" value={r.amount || ""} placeholder="0"
                onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, amount: Number(e.target.value) || 0 } : x)))} />
              <button type="button" aria-label="Remove" className="text-muted px-1" onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
        </div>
        <button type="button" className="text-sm text-accent mt-2" onClick={() => setRows([...rows, { name: "", amount: 0 }])}>+ Add bill</button>
        <p className="text-xs text-muted mt-2">
          Bills you owe no matter what you earn. Name your debt line with &ldquo;Debt&rdquo; and the payoff planner treats it as your current debt payment.
          Subscriptions are detected from your transactions automatically.
        </p>
        <div className="flex justify-between text-sm pt-3 mt-3 border-t border-line num">
          <span className="text-muted">You need to earn at least</span>
          <span className="font-semibold">{money(fixed, { cents: false })}/mo <span className="font-normal text-muted">+ subscriptions & spending</span></span>
        </div>
      </div>

      <button className="btn w-full" disabled={pending}>{saved ? "Saved ✓" : pending ? "Saving…" : "Save"}</button>
    </form>
  );
}
