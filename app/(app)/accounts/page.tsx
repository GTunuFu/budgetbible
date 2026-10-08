import { getAccounts, money } from "@/lib/data";
import { db, getSetting } from "@/lib/db";
import { addManualAccount, deleteAccount, disconnectSimpleFin, updateAccount } from "@/app/actions";
import ConnectForm from "./ConnectForm";
import SyncButton from "@/components/SyncButton";

const KINDS = [
  ["checking", "Checking / debit"],
  ["savings", "Savings"],
  ["credit", "Credit card"],
  ["loan", "Loan"],
] as const;

const GROUP_LABEL: Record<string, string> = { checking: "Checking", savings: "Savings", credit: "Credit cards", loan: "Loans" };

export default async function AccountsPage() {
  const [accounts, access, lastSync] = await Promise.all([
    getAccounts(),
    getSetting<string | null>("simplefin_access", null),
    getSetting<string | null>("last_sync_at", null),
  ]);
  const sql = await db();
  const [lastLog] = await sql<{ ok: boolean; summary: { warnings?: string[]; error?: string } }[]>`
    select ok, summary from sync_log order by id desc limit 1`;
  const groups = ["checking", "savings", "credit", "loan"].map((k) => ({ k, list: accounts.filter((a) => a.kind === k) }));

  return (
    <main className="space-y-4">
      <header className="flex items-start justify-between pt-1">
        <div>
          <div className="eyebrow">Accounts</div>
          <h1 className="text-[22px] font-semibold tracking-tight">Balances</h1>
        </div>
        <SyncButton lastSync={lastSync} connected={!!access} />
      </header>

      {!access ? (
        <section className="card p-4 space-y-3">
          <div className="font-semibold">Connect your banks with SimpleFIN</div>
          <ol className="text-sm text-muted list-decimal pl-5 space-y-1">
            <li>Go to <a className="text-accent underline" href="https://beta-bridge.simplefin.org" target="_blank" rel="noreferrer">SimpleFIN Bridge</a> and sign up ($1.50/mo).</li>
            <li>Add Chase, SoFi, Capital One, Discover, and your student loan servicer.</li>
            <li>Choose <b>New app connection</b>, copy the setup token, and paste it below.</li>
          </ol>
          <ConnectForm />
          <p className="text-[11px] text-muted">Read-only. The app never sees your bank passwords; it stores an encrypted access key and syncs once a day.</p>
        </section>
      ) : (
        lastLog && (lastLog.summary?.warnings?.length || !lastLog.ok) ? (
          <div className="rounded-2xl bg-warn-soft text-warn px-4 py-3 text-sm">
            {lastLog.ok ? lastLog.summary.warnings!.join(" · ") : `Last sync failed: ${lastLog.summary?.error}`}
          </div>
        ) : null
      )}

      {groups.filter((g) => g.list.length).map((g) => (
        <section key={g.k}>
          <div className="flex justify-between eyebrow mb-1.5">
            <span>{GROUP_LABEL[g.k]}</span>
            <span className="num">{money(Math.abs(g.list.filter((a) => !a.hidden).reduce((s, a) => s + a.balance, 0)), { cents: false })}</span>
          </div>
          <ul className="card divide-y divide-line overflow-hidden">
            {g.list.map((a) => {
              const debt = a.kind === "credit" || a.kind === "loan";
              const save = updateAccount.bind(null, a.id);
              return (
                <li key={a.id}>
                  <details className="group">
                    <summary className="flex items-center justify-between px-4 py-3 list-none cursor-pointer">
                      <div className="min-w-0">
                        <div className={`text-[15px] truncate ${a.hidden ? "text-muted" : ""}`}>{a.nickname ?? a.name}</div>
                        <div className="text-xs text-muted truncate">
                          {a.org_name ?? (a.source === "manual" ? "Manual" : "")}
                          {debt && (a.apr != null ? ` · ${a.apr}% APR` : " · add APR")}
                          {a.balance_date && ` · as of ${new Date(a.balance_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`figure text-lg ${debt && a.balance < 0 ? "text-bad" : ""}`}>{money(Math.abs(a.balance))}</div>
                        {a.available != null && !debt && Math.abs(a.available - a.balance) > 0.5 && (
                          <div className="text-[11px] text-muted num">{money(a.available)} available</div>
                        )}
                      </div>
                    </summary>
                    <form action={save} className="px-4 pb-4 pt-1 grid grid-cols-2 gap-3 bg-paper/50">
                      <label className="col-span-2 block"><span className="text-xs text-muted">Nickname</span>
                        <input name="nickname" className="field" defaultValue={a.nickname ?? ""} placeholder={a.name} /></label>
                      <label className="block"><span className="text-xs text-muted">Type</span>
                        <select name="kind" className="field" defaultValue={a.kind}>
                          {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select></label>
                      {a.source === "manual" ? (
                        <label className="block"><span className="text-xs text-muted">{debt ? "Amount owed" : "Balance"}</span>
                          <input name="balance" inputMode="decimal" className="field" defaultValue={Math.abs(a.balance)} /></label>
                      ) : <div />}
                      <label className="block"><span className="text-xs text-muted">APR %</span>
                        <input name="apr" inputMode="decimal" className="field" defaultValue={a.apr ?? ""} placeholder="e.g. 24.99" /></label>
                      <label className="block"><span className="text-xs text-muted">Min. payment</span>
                        <input name="min_payment" inputMode="decimal" className="field" defaultValue={a.min_payment ?? ""} placeholder="$/mo" /></label>
                      <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" name="hidden" defaultChecked={a.hidden} /> Hide from totals</label>
                      <button className="btn col-span-2">Save</button>
                    </form>
                    {a.source === "manual" && (
                      <form action={deleteAccount.bind(null, a.id)} className="px-4 pb-3 bg-paper/50">
                        <button className="text-xs text-bad">Remove account</button>
                      </form>
                    )}
                  </details>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <details className="card">
        <summary className="px-4 py-3 font-medium cursor-pointer list-none">+ Add an account by hand</summary>
        <form action={addManualAccount} className="px-4 pb-4 grid grid-cols-2 gap-3">
          <p className="col-span-2 text-xs text-muted">For anything SimpleFIN can&apos;t reach (e.g. a student loan servicer or Apple Card). Update the balance now and then.</p>
          <label className="col-span-2 block"><span className="text-xs text-muted">Name</span>
            <input name="name" className="field" placeholder="Student Loans" required /></label>
          <label className="block"><span className="text-xs text-muted">Type</span>
            <select name="kind" className="field" defaultValue="loan">{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label className="block"><span className="text-xs text-muted">Balance / owed</span>
            <input name="balance" inputMode="decimal" className="field" required /></label>
          <label className="block"><span className="text-xs text-muted">APR %</span>
            <input name="apr" inputMode="decimal" className="field" /></label>
          <label className="block"><span className="text-xs text-muted">Min. payment</span>
            <input name="min_payment" inputMode="decimal" className="field" /></label>
          <button className="btn col-span-2">Add account</button>
        </form>
      </details>

      {access && (
        <form action={disconnectSimpleFin} className="text-center pt-2">
          <button className="text-xs text-muted underline">Disconnect SimpleFIN</button>
        </form>
      )}
    </main>
  );
}
