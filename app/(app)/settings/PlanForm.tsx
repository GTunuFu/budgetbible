"use client";
import { useState, useTransition } from "react";
import { savePlan } from "@/app/actions";
import type { Plan } from "@/lib/data";
import { money } from "@/lib/format";

export default function PlanForm({ plan }: { plan: Plan }) {
  const [rows, setRows] = useState(plan.fixedCosts.length ? plan.fixedCosts : [{ name: "", amount: 0 }]);
  const [income, setIncome] = useState(plan.monthlyIncome || 0);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const fixed = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);

  return (
    <form
      action={(fd) => start(async () => { await savePlan(fd); setSaved(true); setTimeout(() => setSaved(false), 2000); })}
      className="card p-4 space-y-4"
    >
      <div className="grid grid-cols-2 gap-3">
        <label className="block"><span className="text-xs text-muted block mb-1">Monthly take-home</span>
          <input name="income" inputMode="decimal" className="field" value={income || ""} onChange={(e) => setIncome(Number(e.target.value) || 0)} placeholder="5394" />
        </label>
        <label className="block"><span className="text-xs text-muted block mb-1">Paid</span>
          <select name="pay_frequency" className="field" defaultValue={plan.payFrequency}>
            <option value="monthly">Monthly</option>
            <option value="semimonthly">Twice a month</option>
            <option value="biweekly">Every 2 weeks</option>
          </select>
        </label>
      </div>

      <div>
        <div className="eyebrow mb-2">Fixed costs</div>
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
        <button type="button" className="text-sm text-accent mt-2" onClick={() => setRows([...rows, { name: "", amount: 0 }])}>+ Add fixed cost</button>
        <p className="text-xs text-muted mt-2">
          Name your debt line with &ldquo;Debt&rdquo; (e.g. Monthly Debt Contributions) and the payoff planner will treat it as your current debt payment.
          Subscriptions are found automatically from your transactions.
        </p>
      </div>

      <div className="flex justify-between text-sm pt-3 border-t border-line num">
        <span className="text-muted">Income − fixed</span>
        <span className="font-semibold">{money(income - fixed, { cents: false })}</span>
      </div>
      <button className="btn w-full" disabled={pending}>{saved ? "Saved ✓" : pending ? "Saving…" : "Save plan"}</button>
    </form>
  );
}
