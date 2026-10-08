import Link from "next/link";
import { getAccounts, getCategories, getInboxCount, getMonthSummary, getPlan, getRecurring, money } from "@/lib/data";
import { getSetting } from "@/lib/db";
import { monthLabel, monthOf, today } from "@/lib/dates";
import SyncButton from "@/components/SyncButton";

export default async function Home() {
  const month = monthOf(today());
  const [m, accounts, inbox, plan, recurring, lastSync, access, cats] = await Promise.all([
    getMonthSummary(month),
    getAccounts(),
    getInboxCount(),
    getPlan(),
    getRecurring(month),
    getSetting<string | null>("last_sync_at", null),
    getSetting<string | null>("simplefin_access", null),
    getCategories(),
  ]);

  const visible = accounts.filter((a) => !a.hidden);
  const cash = visible.filter((a) => a.kind === "checking" || a.kind === "savings").reduce((s, a) => s + a.balance, 0);
  const cards = -visible.filter((a) => a.kind === "credit").reduce((s, a) => s + a.balance, 0);
  const loans = -visible.filter((a) => a.kind === "loan").reduce((s, a) => s + a.balance, 0);

  const used = m.allowance > 0 ? Math.min(1, Math.max(0, m.discretionary / m.allowance)) : m.discretionary > 0 ? 1 : 0;
  const elapsed = m.dayOfMonth / m.daysInMonth;
  const daysLeft = m.daysInMonth - m.dayOfMonth + 1;
  const overPace = used > elapsed + 0.05;
  const upcoming = recurring.filter((r) => !r.chargedThisMonth);
  const needsBills = !plan.fixedCosts.some((f) => f.amount > 0);
  const needsIncome = !cats.some((c) => c.kind === "income");
  const needsSetup = needsBills || needsIncome;
  const runway = m.monthlyBurn > 0 ? cash / m.monthlyBurn : null;
  const covered = m.monthlyBurn > 0 ? Math.min(1, (m.actualIncome - m.taxSetAside) / m.monthlyBurn) : 0;

  return (
    <main className="space-y-4">
      <header className="flex items-start justify-between pt-1">
        <div>
          <div className="eyebrow">{monthLabel(month)}</div>
          <h1 className="text-[22px] font-semibold tracking-tight">Budget Bible</h1>
        </div>
        <div className="flex items-start gap-3">
          <SyncButton lastSync={lastSync} connected={!!access} />
          <Link href="/settings" aria-label="Settings" className="text-muted p-1 -m-1">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
          </Link>
        </div>
      </header>

      {(needsSetup || !access) && (
        <div className="card p-4 space-y-2 border-dashed">
          <div className="font-semibold">Finish setting up</div>
          <ol className="text-sm text-muted space-y-1 list-decimal pl-5">
            {!access && <li><Link className="text-accent underline" href="/accounts">Connect SimpleFIN</Link> to pull your banks and cards.</li>}
            {needsBills && <li><Link className="text-accent underline" href="/settings">Enter your monthly bills</Link> (rent, utilities, debt).</li>}
            {needsIncome && <li>When a payment comes in, file it under a new <b>income</b> category on its swipe card (e.g. &ldquo;Income - Freelance&rdquo;). Your budget is built from real deposits.</li>}
          </ol>
        </div>
      )}

      {/* Safe to spend */}
      <section className="card p-5">
        <div className="eyebrow">Safe to spend this month</div>
        <div className={`figure text-[52px] leading-none mt-2 ${m.safeToSpend < 0 ? "text-bad" : ""}`}>
          {money(m.safeToSpend, { cents: false })}
        </div>
        <div className="text-sm text-muted mt-2">
          {m.safeToSpend > 0
            ? <>About <span className="text-ink font-medium num">{money(m.perDayLeft, { cents: false })}/day</span> for the next {daysLeft} days</>
            : m.allowance < 0
              ? <>Bills and subscriptions are {money(-m.allowance, { cents: false })} more than planned income, so there&apos;s nothing free to spend yet</>
              : <>You&apos;re past this month&apos;s allowance by {money(-m.safeToSpend, { cents: false })}</>}
        </div>

        <div className="mt-5">
          <div className="relative h-2.5 rounded-full bg-line overflow-hidden">
            <div className={`absolute inset-y-0 left-0 rounded-full ${overPace ? "bg-bad" : "bg-accent"}`} style={{ width: `${used * 100}%` }} />
          </div>
          <div className="relative h-0">
            <div className="absolute -top-[14px] w-0.5 h-[18px] bg-ink" style={{ left: `calc(${elapsed * 100}% - 1px)` }} />
          </div>
          <div className="flex justify-between text-xs text-muted mt-2 num">
            <span>{money(m.discretionary, { cents: false })} spent of {money(Math.max(0, m.allowance), { cents: false })}</span>
            <span>{Math.round(elapsed * 100)}% of month gone</span>
          </div>
        </div>

        <div className="text-xs text-muted mt-3">
          Planned on <span className="text-ink">{m.incomeBasis}</span>: <span className="num">{money(m.plannedIncome, { cents: false })}</span>
        </div>
        <dl className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-line text-sm">
          <Stat label="Planned income" value={m.plannedIncome} />
          <Stat label="Bills" value={-m.fixedTotal} />
          <Stat label="Recurring" value={-m.recurringTotal} />
        </dl>
      </section>

      {/* Irregular income: what's come in vs what the month costs */}
      <section className="card p-4">
        <div className="flex justify-between items-baseline">
          <div className="eyebrow">Earned this month</div>
          {runway != null && (
            <div className="text-xs text-muted">
              Runway <span className={`font-semibold num ${runway < 2 ? "text-bad" : runway < 4 ? "text-warn" : "text-ink"}`}>{runway.toFixed(1)} mo</span>
            </div>
          )}
        </div>
        <div className="flex items-baseline gap-2 mt-1">
          <span className="figure text-3xl">{money(m.actualIncome, { cents: false })}</span>
          <span className="text-sm text-muted num">of {money(m.monthlyBurn, { cents: false })} the month costs</span>
        </div>
        <div className="h-2 rounded-full bg-line mt-3 overflow-hidden">
          <div className="h-full rounded-full bg-accent" style={{ width: `${covered * 100}%` }} />
        </div>
        <div className="flex justify-between text-xs text-muted mt-2 num">
          <span>{covered >= 1 ? "Month covered ✓" : `${money(Math.max(0, m.monthlyBurn - m.actualIncome + m.taxSetAside), { cents: false })} to go`}</span>
          {m.taxSetAside > 0 && <span>Set aside for taxes: <b className="text-ink">{money(m.taxSetAside, { cents: false })}</b></span>}
        </div>
        {runway != null && (
          <p className="text-[11px] text-muted mt-2">Runway = cash in checking + savings ÷ a typical month (bills, subscriptions, everyday spending).</p>
        )}
      </section>

      {inbox > 0 && (
        <Link href="/review" className="card p-4 flex items-center justify-between active:scale-[0.99] transition">
          <div>
            <div className="font-semibold">{inbox} to swipe</div>
            <div className="text-sm text-muted">New purchases waiting for a category</div>
          </div>
          <span className="btn whitespace-nowrap">Review →</span>
        </Link>
      )}

      {m.pendingCount > 0 && (
        <div className="rounded-2xl bg-warn-soft text-warn px-4 py-3 text-sm">
          <span className="font-semibold num">{money(m.pendingTotal)}</span> still pending across {m.pendingCount} charge{m.pendingCount === 1 ? "" : "s"}.
          Already counted on the day you bought them, so nothing moves when they post.
        </div>
      )}

      {/* Accounts */}
      <section className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="eyebrow">Where things stand</div>
          <Link href="/accounts" className="text-xs text-muted">Accounts →</Link>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Tile label="Cash" value={money(cash, { cents: false })} />
          <Tile label="Card debt" value={money(cards, { cents: false })} tone={cards > 0 ? "bad" : undefined} />
          <Tile label="Student loans" value={money(loans, { cents: false })} tone={loans > 0 ? "bad" : undefined} />
          <Tile label="Net worth" value={money(cash - cards - loans, { cents: false })} />
        </div>
        {cards + loans > 0 && (
          <Link href="/payoff" className="mt-3 block text-sm text-accent font-medium">Plan your payoff →</Link>
        )}
      </section>

      {/* Categories */}
      <section className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="eyebrow">Spending by category</div>
          <Link href="/activity" className="text-xs text-muted">All activity →</Link>
        </div>
        {m.byCategory.length === 0 && <p className="text-sm text-muted">Nothing yet this month.</p>}
        <ul className="space-y-3">
          {m.byCategory.map((c) => {
            const pct = c.budget > 0 ? Math.min(1, c.spent / c.budget) : 0;
            const over = c.budget > 0 && c.spent > c.budget;
            return (
              <li key={c.name}>
                <Link href={`/activity?category=${encodeURIComponent(c.name)}`} className="block">
                  <div className="flex justify-between text-sm">
                    <span className={c.name === "Uncategorized" ? "text-muted italic" : ""}>{c.name}</span>
                    <span className="num">
                      <span className={over ? "text-bad font-semibold" : "font-medium"}>{money(c.spent, { cents: false })}</span>
                      {c.budget > 0 && <span className="text-muted"> / {money(c.budget, { cents: false })}</span>}
                    </span>
                  </div>
                  {c.budget > 0 && (
                    <div className="h-1.5 rounded-full bg-line mt-1.5 overflow-hidden">
                      <div className={`h-full rounded-full ${over ? "bg-bad" : "bg-accent"}`} style={{ width: `${pct * 100}%` }} />
                    </div>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Recurring */}
      {recurring.length > 0 && (
        <section className="card p-4">
          <div className="eyebrow mb-3">Recurring · {money(m.recurringTotal)}/mo</div>
          <ul className="divide-y divide-line">
            {recurring.map((r) => (
              <li key={r.merchant_key} className="flex justify-between py-2 text-sm">
                <span className={r.chargedThisMonth ? "text-muted" : ""}>
                  {r.label}
                  {r.chargedThisMonth && <span className="ml-1.5 text-[11px] text-accent">✓ paid</span>}
                </span>
                <span className="num">{money(r.amount)}</span>
              </li>
            ))}
          </ul>
          {upcoming.length > 0 && (
            <p className="text-xs text-muted mt-2">{upcoming.length} still to hit this month.</p>
          )}
        </section>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="num font-medium">{money(value, { cents: false })}</dd>
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: "bad" }) {
  return (
    <div className="rounded-xl bg-paper px-3 py-2.5">
      <div className="text-xs text-muted">{label}</div>
      <div className={`figure text-xl ${tone === "bad" ? "text-bad" : ""}`}>{value}</div>
    </div>
  );
}
