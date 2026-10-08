import Link from "next/link";
import { getCategories, getIncomePicture, getPlan, type IncomeMode } from "@/lib/data";
import { addCategory, deleteCategory, logout, saveCategories } from "@/app/actions";
import { monthOf, today } from "@/lib/dates";
import PlanForm from "./PlanForm";

export default async function SettingsPage() {
  const [plan, cats] = await Promise.all([getPlan(), getCategories()]);
  const month = monthOf(today());
  // what each income mode would give you right now
  const preview: Partial<Record<IncomeMode, number>> = {};
  for (const m of ["avg3", "last_month", "lowest6"] as IncomeMode[]) {
    const p = await getIncomePicture(month, { ...plan, incomeMode: m });
    if (p.history.length) preview[m] = p.planningIncome;
  }
  const userCats = cats.filter((c) => c.kind !== "transfer");

  return (
    <main className="space-y-4">
      <header className="pt-1">
        <Link href="/" className="text-sm text-muted">‹ Home</Link>
        <h1 className="text-[22px] font-semibold tracking-tight mt-1">Your plan</h1>
      </header>

      <PlanForm plan={plan} preview={preview} />

      <section className="card p-4">
        <div className="eyebrow mb-1">Categories</div>
        <p className="text-xs text-muted mb-3">
          Make your own as you go, from the swipe cards or here. Spending categories can have an optional monthly cap.
        </p>
        {userCats.length === 0 && <p className="text-sm text-muted mb-3">None yet. Your first swipe will start the list.</p>}
        {userCats.length > 0 && (
          <form action={saveCategories} className="space-y-3">
            {userCats.map((c) => (
              <div key={c.name} className="rounded-xl border border-line p-3 space-y-2">
                <input type="hidden" name="cat" value={c.name} />
                <div className="flex gap-2 items-center">
                  <input name={`rename:${c.name}`} defaultValue={c.name} className="field !py-1.5 !text-[15px] font-medium" aria-label="Category name" />
                  <select name={`kind:${c.name}`} defaultValue={c.kind === "income" ? "income" : "spend"} className="field !w-28 !py-1.5 !text-[15px]">
                    <option value="spend">Spending</option>
                    <option value="income">Income</option>
                  </select>
                </div>
                {c.kind === "income" ? (
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name={`taxable:${c.name}`} defaultChecked={c.taxable} /> Taxes not withheld (freelance / 1099)
                  </label>
                ) : (
                  <label className="flex items-center justify-between text-sm text-muted">
                    <span>Monthly cap (optional)</span>
                    <span className="flex items-center gap-1">$
                      <input name={`budget:${c.name}`} inputMode="decimal" defaultValue={c.budget || ""} placeholder="—"
                        className="w-24 text-right field !py-1.5 !text-[15px]" />
                    </span>
                  </label>
                )}
                <button formAction={deleteCategory.bind(null, c.name)} className="text-xs text-bad">Delete</button>
              </div>
            ))}
            <button className="btn w-full">Save categories</button>
            <p className="text-[11px] text-muted">Renaming one to the name of another merges them. Deleting sends its purchases back to Review.</p>
          </form>
        )}
        <form action={addCategory} className="mt-4 pt-4 border-t border-line space-y-2">
          <div className="flex gap-2">
            <input name="name" className="field" placeholder="New category" required />
            <select name="kind" className="field !w-28" defaultValue="spend">
              <option value="spend">Spending</option>
              <option value="income">Income</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" name="taxable" /> If income: taxes not withheld
          </label>
          <button className="btn btn-ghost w-full">Add category</button>
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
