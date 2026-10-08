import { db } from "@/lib/db";
import { requireAuth } from "@/lib/session";

export const dynamic = "force-dynamic";

const esc = (v: unknown) => {
  const s = v == null ? "" : Array.isArray(v) ? v.join("|") : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET() {
  await requireAuth();
  const sql = await db();
  const rows = await sql`
    select t.purchase_date, t.posted_date, t.status, coalesce(a.nickname, a.name) account, t.description, t.amount,
      t.category, t.tags, t.is_recurring, t.is_transfer, t.notes
    from transactions t left join accounts a on a.id = t.account_id
    where t.merged_into is null order by t.purchase_date desc`;
  const cols = ["purchase_date", "posted_date", "status", "account", "description", "amount", "category", "tags", "is_recurring", "is_transfer", "notes"];
  const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="budgetbible-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
