import Link from "next/link";
import { db } from "@/lib/db";
import { money, type Tx } from "@/lib/data";
import { prettyMerchant } from "@/lib/merchant";
import { monthBounds, monthLabel, monthOf, shiftMonth, shortDay, today } from "@/lib/dates";

export default async function Activity({ searchParams }: { searchParams: Promise<{ m?: string; category?: string }> }) {
  const sp = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(sp.m ?? "") ? sp.m! : monthOf(today());
  const { start, next } = monthBounds(month);
  const category = sp.category || null;
  const sql = await db();
  const rows = await sql<(Tx & { account_name: string | null })[]>`
    select t.*, coalesce(a.nickname, a.name) account_name from transactions t left join accounts a on a.id = t.account_id
    where t.purchase_date >= ${start} and t.purchase_date < ${next} and t.merged_into is null
      ${category === "Uncategorized" ? sql`and t.category is null` : category ? sql`and t.category = ${category}` : sql``}
    order by t.purchase_date desc, t.created_at desc`;

  type Row = (typeof rows)[number];
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const g: Row[] = groups.get(r.purchase_date) ?? [];
    g.push(r);
    groups.set(r.purchase_date, g);
  }
  const qs = (m: string) => `/activity?m=${m}${category ? `&category=${encodeURIComponent(category)}` : ""}`;

  return (
    <main>
      <header className="flex items-end justify-between pt-1 mb-4">
        <div>
          <div className="eyebrow">Activity{category ? ` · ${category}` : ""}</div>
          <div className="flex items-center gap-3">
            <Link href={qs(shiftMonth(month, -1))} className="text-muted text-xl px-1" aria-label="Previous month">‹</Link>
            <h1 className="text-[22px] font-semibold tracking-tight">{monthLabel(month)}</h1>
            <Link href={qs(shiftMonth(month, 1))} className="text-muted text-xl px-1" aria-label="Next month">›</Link>
          </div>
        </div>
        <Link href="/activity/new" className="btn !px-3 !py-2" aria-label="Add purchase">+ Add</Link>
      </header>

      {category && <Link href={`/activity?m=${month}`} className="chip mb-3" data-on>{category} ✕</Link>}

      <p className="text-xs text-muted mb-4">
        Sorted by the day you bought it. If the bank posts it later, the posted date shows underneath and nothing moves.
      </p>

      {rows.length === 0 && <div className="card p-6 text-center text-muted text-sm">No transactions.</div>}

      <div className="space-y-5">
        {[...groups.entries()].map(([day, list]) => (
          <section key={day}>
            <div className="eyebrow mb-1.5">{shortDay(day)}</div>
            <ul className="card divide-y divide-line overflow-hidden">
              {list.map((t) => {
                const muted = t.status === "dropped" || t.is_transfer;
                return (
                  <li key={t.id}>
                    <Link href={`/activity/${t.id}`} className="flex items-center gap-3 px-4 py-3 active:bg-paper">
                      <div className="flex-1 min-w-0">
                        <div className={`text-[15px] truncate ${muted ? "text-muted line-through decoration-1" : ""}`}>
                          {t.source === "manual" ? t.description : prettyMerchant(t.description)}
                        </div>
                        <div className="text-xs text-muted truncate flex gap-1.5 items-center">
                          {t.category ? <span>{t.category}</span> : t.status !== "dropped" && <span className="text-warn font-medium">Needs a category</span>}
                          {t.is_recurring && <span>· ↻</span>}
                          {t.tags.includes("stupid") && <span className="text-bad">· stupid</span>}
                          {t.status === "pending" && <span className="text-warn">· {t.source === "manual" ? "not posted yet" : "pending"}</span>}
                          {t.status === "posted" && t.posted_date && t.posted_date !== t.purchase_date && (
                            <span>· posted {shortDay(t.posted_date)}</span>
                          )}
                          {t.status === "dropped" && <span>· dropped by bank</span>}
                          {t.possible_dup_of && <span className="text-warn">· duplicate?</span>}
                        </div>
                      </div>
                      <div className={`num text-[15px] font-medium ${t.amount > 0 ? "text-accent" : ""} ${muted ? "text-muted" : ""}`}>
                        {money(t.amount, { sign: true })}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      <div className="text-center mt-6">
        <a href="/api/export" className="text-xs text-muted underline">Export everything as CSV</a>
      </div>
    </main>
  );
}
