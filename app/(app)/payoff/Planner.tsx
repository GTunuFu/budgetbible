"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { monthlyNeededFor, simulate, type Debt } from "@/lib/payoff";
import { money } from "@/lib/format";

type D = Debt & { aprKnown: boolean; minKnown: boolean };

const PRESETS = [6, 12, 18, 24, 36, 60];

function monthName(offset: number) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

export default function Planner(props: {
  debts: D[]; income: number; incomeBasis: string; otherFixed: number; recurring: number; avgSpending: number; currentDebtPayment: number;
}) {
  const { income, otherFixed, recurring, currentDebtPayment } = props;
  const [mode, setMode] = useState<"target" | "budget">("target");
  const [months, setMonths] = useState(12);
  const [strategy, setStrategy] = useState<"avalanche" | "snowball">("avalanche");
  const [includeLoans, setIncludeLoans] = useState(false);
  const [spending, setSpending] = useState(props.avgSpending);
  const [monthlyInput, setMonthlyInput] = useState(Math.max(currentDebtPayment, 0) || 850);

  const debts = useMemo(() => props.debts.filter((d) => includeLoans || d.kind === "credit"), [props.debts, includeLoans]);
  const hasLoans = props.debts.some((d) => d.kind === "loan");
  const total = debts.reduce((s, d) => s + d.balance, 0);
  const minTotal = debts.reduce((s, d) => s + Math.min(d.minPayment, d.balance), 0);

  // excluded debts still need their minimums paid
  const excludedMins = props.debts.filter((d) => !debts.includes(d)).reduce((s, d) => s + d.minPayment, 0);
  const canAfford = income - otherFixed - recurring - spending - excludedMins;

  const needed = useMemo(() => (mode === "target" ? monthlyNeededFor(debts, months, strategy) : 0), [debts, months, strategy, mode]);
  const monthly = mode === "target" ? needed : monthlyInput;
  const sim = useMemo(() => simulate(debts, monthly, strategy), [debts, monthly, strategy]);
  const minOnly = useMemo(() => simulate(debts, minTotal, strategy), [debts, minTotal, strategy]);

  const gap = canAfford - monthly;
  const guessed = debts.filter((d) => !d.aprKnown || !d.minKnown);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-line/60 text-sm font-medium">
        <button className={`py-2 rounded-lg ${mode === "target" ? "bg-card shadow-sm" : "text-muted"}`} onClick={() => setMode("target")}>Pay off by…</button>
        <button className={`py-2 rounded-lg ${mode === "budget" ? "bg-card shadow-sm" : "text-muted"}`} onClick={() => setMode("budget")}>I can pay…</button>
      </div>

      <section className="card p-5">
        {mode === "target" ? (
          <>
            <div className="eyebrow">Debt-free in</div>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="figure text-5xl">{months}</span>
              <span className="text-muted">months · {monthName(months)}</span>
            </div>
            <input type="range" min={3} max={84} value={months} onChange={(e) => setMonths(Number(e.target.value))} className="w-full mt-3 accent-[var(--accent)]" />
            <div className="flex gap-1.5 flex-wrap mt-2">
              {PRESETS.map((p) => (
                <button key={p} className="chip !py-1 !text-xs" data-on={months === p} onClick={() => setMonths(p)}>
                  {p < 12 ? `${p} mo` : `${p / 12} yr`}
                </button>
              ))}
            </div>
            <div className="mt-5 pt-4 border-t border-line">
              <div className="eyebrow">You need to pay</div>
              <div className="figure text-[44px] leading-tight">{money(needed, { cents: false })}<span className="text-lg text-muted">/mo</span></div>
            </div>
          </>
        ) : (
          <>
            <div className="eyebrow">Each month I&apos;ll put toward debt</div>
            <div className="flex items-center gap-1 mt-2">
              <span className="figure text-4xl text-muted">$</span>
              <input
                inputMode="decimal"
                className="figure text-5xl bg-transparent w-full outline-none"
                value={monthlyInput || ""}
                onChange={(e) => setMonthlyInput(Number(e.target.value.replace(/[^\d.]/g, "")) || 0)}
              />
            </div>
            <div className="mt-4 pt-4 border-t border-line">
              {sim.feasible ? (
                <>
                  <div className="eyebrow">Debt-free in</div>
                  <div className="figure text-[44px] leading-tight">{sim.months} <span className="text-lg text-muted">months · {monthName(sim.months)}</span></div>
                </>
              ) : (
                <p className="text-bad text-sm">
                  {monthly < minTotal ? `That's below your minimums (${money(minTotal, { cents: false })}/mo).` : "At this amount the balance doesn't shrink. Try more."}
                </p>
              )}
            </div>
          </>
        )}

        {sim.feasible && (
          <dl className="grid grid-cols-2 gap-3 mt-4 text-sm">
            <div><dt className="text-xs text-muted">Interest you&apos;ll pay</dt><dd className="num font-medium text-bad">{money(sim.totalInterest, { cents: false })}</dd></div>
            <div><dt className="text-xs text-muted">Minimums only</dt><dd className="num font-medium">
              {minOnly.feasible ? `${Math.ceil(minOnly.months / 12)} yrs · ${money(minOnly.totalInterest, { cents: false })} interest` : "never"}
            </dd></div>
          </dl>
        )}
        {sim.feasible && <BalanceChart balances={sim.balances} />}
      </section>

      {/* Affordability */}
      <section className="card p-4">
        <div className="eyebrow mb-3">Can your income cover it?</div>
        <ul className="text-sm space-y-1.5 num">
          <Line k="Planned income" v={income} />
          <li className="text-[11px] text-muted -mt-1">Based on {props.incomeBasis}. Your pay varies, so treat this as a range.</li>
          <Line k="Fixed costs (rent, utilities…)" v={-otherFixed} />
          <Line k="Recurring subscriptions" v={-recurring} />
          <li className="flex justify-between items-center">
            <span className="text-muted">Everyday spending</span>
            <span className="flex items-center gap-1">−$<input inputMode="decimal" value={spending}
              onChange={(e) => setSpending(Number(e.target.value.replace(/[^\d.]/g, "")) || 0)}
              className="w-20 text-right bg-paper border border-line rounded-md px-1.5 py-0.5" /></span>
          </li>
          {excludedMins > 0 && <Line k="Student loan minimums" v={-excludedMins} />}
          <li className="flex justify-between pt-2 border-t border-line font-semibold">
            <span>Left for debt payoff</span><span>{money(canAfford, { cents: false })}</span>
          </li>
        </ul>
        {!income ? (
          <p className="text-sm text-muted mt-3">File your deposits under an income category (or <Link href="/settings" className="text-accent underline">set a baseline</Link>) to see whether this fits.</p>
        ) : (
          <div className={`mt-3 rounded-xl px-3 py-2.5 text-sm ${gap >= 0 ? "bg-accent-soft text-accent" : "bg-bad-soft text-bad"}`}>
            {gap >= 0
              ? <>This plan fits, with {money(gap, { cents: false })}/mo to spare.</>
              : <>You&apos;re short {money(-gap, { cents: false })}/mo. Cut everyday spending to about {money(Math.max(0, spending + gap), { cents: false })}, or pick a longer timeline.</>}
            {currentDebtPayment > 0 && (
              <div className="text-xs opacity-80 mt-1">You budget {money(currentDebtPayment, { cents: false })}/mo for debt today.</div>
            )}
          </div>
        )}
      </section>

      {/* Per-debt */}
      <section className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="eyebrow">Order of attack</div>
          <div className="flex gap-1">
            <button className="chip !py-1 !text-xs" data-on={strategy === "avalanche"} onClick={() => setStrategy("avalanche")}>Highest APR</button>
            <button className="chip !py-1 !text-xs" data-on={strategy === "snowball"} onClick={() => setStrategy("snowball")}>Smallest first</button>
          </div>
        </div>
        <ul className="divide-y divide-line">
          {[...debts]
            .sort((a, b) => (sim.payoffMonth[a.id] ?? 999) - (sim.payoffMonth[b.id] ?? 999))
            .map((d) => (
              <li key={d.id} className="py-2.5 flex justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <div className="font-medium truncate">{d.name}</div>
                  <div className="text-xs text-muted">
                    {d.apr}% APR{!d.aprKnown && " (guess)"} · min {money(d.minPayment, { cents: false })}{!d.minKnown && " (est.)"}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="num font-medium">{money(d.balance, { cents: false })}</div>
                  <div className="text-xs text-muted">{sim.payoffMonth[d.id] ? `gone ${monthName(sim.payoffMonth[d.id])}` : "—"}</div>
                </div>
              </li>
            ))}
        </ul>
        <div className="flex justify-between text-sm font-semibold pt-2 border-t border-line num">
          <span>Total</span><span>{money(total, { cents: false })}</span>
        </div>
        {hasLoans && (
          <label className="flex items-center gap-2 text-sm mt-3">
            <input type="checkbox" checked={includeLoans} onChange={(e) => setIncludeLoans(e.target.checked)} />
            Include student loans in the payoff goal
          </label>
        )}
        {guessed.length > 0 && (
          <p className="text-xs text-warn mt-3">
            Some APRs or minimums are guesses. <Link href="/accounts" className="underline">Add the real ones</Link> (on your statement) for accurate numbers.
          </p>
        )}
        <p className="text-xs text-muted mt-2">
          Pay every minimum, then put all the extra on the {strategy === "avalanche" ? "highest-APR" : "smallest"} balance. When one is gone, roll its payment into the next.
        </p>
      </section>
    </div>
  );
}

function Line({ k, v }: { k: string; v: number }) {
  return <li className="flex justify-between"><span className="text-muted">{k}</span><span>{money(v, { cents: false })}</span></li>;
}

function BalanceChart({ balances }: { balances: number[] }) {
  if (balances.length < 2) return null;
  const W = 320, H = 90;
  const max = balances[0] || 1;
  const pts = balances.map((b, i) => `${(i / (balances.length - 1)) * W},${H - (b / max) * (H - 6) - 3}`);
  const mid = Math.floor((balances.length - 1) / 2);
  return (
    <figure className="mt-4">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-24" preserveAspectRatio="none" role="img" aria-label="Total balance over time">
        <polygon points={`0,${H} ${pts.join(" ")} ${W},${H}`} fill="var(--accent-soft)" />
        <polyline points={pts.join(" ")} fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="flex justify-between text-[11px] text-muted num mt-1">
        <span>Now · {money(balances[0], { cents: false })}</span>
        <span>{monthName(mid)} · {money(balances[mid], { cents: false })}</span>
        <span>{monthName(balances.length - 1)} · $0</span>
      </figcaption>
    </figure>
  );
}
