import Link from "next/link";
import { getAccounts, getCategories } from "@/lib/data";
import { addManualTransaction } from "@/app/actions";
import { today } from "@/lib/dates";

export default async function NewTx({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  const [cats, accounts] = await Promise.all([getCategories(), getAccounts()]);
  return (
    <main>
      <header className="pt-1 mb-4">
        <Link href="/activity" className="text-sm text-muted">‹ Activity</Link>
        <h1 className="text-[22px] font-semibold tracking-tight mt-1">Log a purchase</h1>
        <p className="text-sm text-muted mt-1">
          Handy for cash, or to count something right away. When the bank posts it, the app matches it up instead of double counting.
        </p>
      </header>
      {sp.error && <p className="text-sm text-bad mb-3">Description and amount are required.</p>}
      <form action={addManualTransaction} className="card p-4 space-y-4">
        <label className="block"><span className="text-xs text-muted block mb-1">Amount</span>
          <input name="amount" inputMode="decimal" className="field figure !text-2xl" placeholder="0.00" autoFocus required />
        </label>
        <label className="block"><span className="text-xs text-muted block mb-1">What was it?</span>
          <input name="description" className="field" placeholder="e.g. Pho Today" required />
        </label>
        <label className="block"><span className="text-xs text-muted block mb-1">Category</span>
          <input name="category" list="cats" className="field" placeholder="Pick, type a new one, or leave blank" autoComplete="off" />
          <datalist id="cats">{cats.filter((c) => c.kind !== "transfer").map((c) => <option key={c.name} value={c.name} />)}</datalist>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="text-xs text-muted block mb-1">Date</span>
            <input type="date" name="purchase_date" className="field" defaultValue={today()} />
          </label>
          <label className="block"><span className="text-xs text-muted block mb-1">Paid with</span>
            <select name="account_id" className="field" defaultValue="">
              <option value="">Cash / other</option>
              {accounts.filter((a) => a.kind !== "loan").map((a) => <option key={a.id} value={a.id}>{a.nickname ?? a.name}</option>)}
            </select>
          </label>
        </div>
        <div className="flex gap-5">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="recurring" /> Recurring</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_income" /> This is income</label>
        </div>
        <button className="btn w-full">Save</button>
      </form>
    </main>
  );
}
