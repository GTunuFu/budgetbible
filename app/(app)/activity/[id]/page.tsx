import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getCategories, money, type Tx } from "@/lib/data";
import { deleteTransaction, updateTransaction } from "@/app/actions";
import { shortDay } from "@/lib/dates";

export default async function EditTx({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const sql = await db();
  const [t] = await sql<(Tx & { account_name: string | null })[]>`
    select t.*, coalesce(a.nickname, a.name) account_name from transactions t left join accounts a on a.id = t.account_id where t.id = ${id}`;
  if (!t) notFound();
  const cats = await getCategories();
  const manual = t.source === "manual";
  const save = updateTransaction.bind(null, t.id);
  const del = deleteTransaction.bind(null, t.id);

  return (
    <main>
      <header className="pt-1 mb-4">
        <Link href="/activity" className="text-sm text-muted">‹ Activity</Link>
        <h1 className="text-[22px] font-semibold tracking-tight mt-1">{t.description}</h1>
        <div className={`figure text-4xl mt-1 ${t.amount > 0 ? "text-accent" : ""}`}>{money(t.amount, { sign: true })}</div>
      </header>

      <div className="card p-4 text-sm space-y-1.5 mb-4">
        <Row k="Account" v={t.account_name ?? "—"} />
        <Row k="Bought" v={shortDay(t.purchase_date)} />
        <Row k="Bank posted" v={t.posted_date ? shortDay(t.posted_date) : t.status === "pending" ? "Not yet" : "—"} />
        <Row k="Status" v={t.status === "dropped" ? "Dropped / ignored" : t.status} />
        <Row k="Source" v={manual ? "Entered by you" : "SimpleFIN"} />
      </div>

      <form action={save} className="card p-4 space-y-4">
        <input type="hidden" name="back" value="/activity" />
        {manual && (
          <>
            <Field label="Description"><input name="description" className="field" defaultValue={t.description} /></Field>
            <Field label="Amount"><input name="amount" inputMode="decimal" className="field" defaultValue={Math.abs(t.amount)} /></Field>
          </>
        )}
        <Field label="Category">
          <select name="category" className="field" defaultValue={t.category ?? ""}>
            <option value="">— Needs a category —</option>
            {cats.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Purchase date (what the budget uses)">
          <input type="date" name="purchase_date" className="field" defaultValue={t.purchase_date} />
        </Field>
        <div className="flex gap-5">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="recurring" defaultChecked={t.is_recurring} /> Recurring</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="stupid" defaultChecked={t.tags.includes("stupid")} /> Stupid buy</label>
        </div>
        <Field label="Notes"><textarea name="notes" rows={2} className="field" defaultValue={t.notes ?? ""} /></Field>
        <button className="btn w-full">Save</button>
      </form>

      <form action={del} className="mt-4 text-center">
        <button className="text-sm text-bad">{manual ? "Delete this entry" : "Ignore this transaction"}</button>
      </form>
    </main>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between"><span className="text-muted">{k}</span><span className="capitalize-first">{v}</span></div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="text-xs text-muted block mb-1">{label}</span>{children}</label>;
}
