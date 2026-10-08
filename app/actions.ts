"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSessionToken, safeEqual, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { requireAuth } from "@/lib/session";
import { db, setSetting } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { claimSetupToken } from "@/lib/simplefin";
import { syncFromSimpleFin } from "@/lib/sync";
import { merchantKey, prettyMerchant } from "@/lib/merchant";
import { getPlan, type FixedCost, type Plan } from "@/lib/data";
import { today } from "@/lib/dates";

const num = (v: FormDataEntryValue | null) => {
  if (v == null || String(v).trim() === "") return null;
  const n = Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};

function refreshAll() {
  revalidatePath("/", "layout");
}

// ---------------- auth ----------------

export async function login(_prev: string | null, form: FormData): Promise<string | null> {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return "APP_PASSWORD isn't set on the server yet.";
  const given = String(form.get("password") ?? "");
  await new Promise((r) => setTimeout(r, 400)); // slow down guessing
  if (!safeEqual(given, expected)) return "Wrong password.";
  const jar = await cookies();
  jar.set(SESSION_COOKIE, await createSessionToken(), sessionCookieOptions);
  redirect("/");
}

export async function logout() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}

// ---------------- SimpleFIN ----------------

export async function connectSimpleFin(_prev: string | null, form: FormData): Promise<string | null> {
  await requireAuth();
  try {
    const access = await claimSetupToken(String(form.get("token") ?? ""));
    await setSetting("simplefin_access", encrypt(access));
    await setSetting("last_sync_at", null);
    await syncFromSimpleFin();
  } catch (e) {
    return e instanceof Error ? e.message : "Couldn't connect.";
  }
  refreshAll();
  return null;
}

export async function disconnectSimpleFin() {
  await requireAuth();
  await setSetting("simplefin_access", null);
  refreshAll();
}

export async function syncNow(): Promise<{ ok: boolean; message: string }> {
  await requireAuth();
  try {
    const s = await syncFromSimpleFin();
    refreshAll();
    const bits = [
      s.added && `${s.added} new`,
      s.merged && `${s.merged} pending→posted matched`,
      s.questions && `${s.questions} to confirm`,
      s.transfers && `${s.transfers} transfers paired`,
      s.dropped && `${s.dropped} holds dropped`,
    ].filter(Boolean);
    return { ok: true, message: (bits.length ? bits.join(" · ") : "Up to date") + (s.warnings.length ? ` · ⚠ ${s.warnings.join("; ")}` : "") };
  } catch (e) {
    const sql = await db();
    await sql`insert into sync_log (ok, summary) values (false, ${sql.json({ error: String(e) })})`;
    return { ok: false, message: e instanceof Error ? e.message : "Sync failed" };
  }
}

// ---------------- review / categorize ----------------

async function learn(key: string, category: string, recurring: boolean | null) {
  if (!key) return;
  const sql = await db();
  await sql`
    insert into merchant_rules (merchant_key, category, confirmations) values (${key}, ${category}, 1)
    on conflict (merchant_key) do update set
      confirmations = case when merchant_rules.category = excluded.category then merchant_rules.confirmations + 1 else 1 end,
      category = excluded.category, updated_at = now()`;
  if (recurring != null) {
    await sql`update merchant_rules set recurring = ${recurring ? "yes" : "no"} where merchant_key = ${key}`;
  }
}

export async function fileTransaction(id: string, category: string, opts: { recurring?: boolean; stupid?: boolean } = {}) {
  await requireAuth();
  const sql = await db();
  const [tx] = await sql<{ merchant_key: string; tags: string[]; is_recurring: boolean }[]>`
    select merchant_key, tags, is_recurring from transactions where id = ${id}`;
  if (!tx) return;
  let tags = tx.tags.filter((t) => t !== "stupid");
  if (opts.stupid) tags = [...tags, "stupid"];
  const recurring = opts.recurring ?? tx.is_recurring;
  category = (await ensureCategory(category)) ?? category;
  const isTransfer = SYSTEM.has(category);
  await sql`update transactions set category = ${category}, tags = ${tags}, is_recurring = ${recurring},
            is_transfer = ${isTransfer}, review = 'done', possible_dup_of = null, updated_at = now() where id = ${id}`;
  await learn(tx.merchant_key, category, opts.recurring === undefined ? null : opts.recurring);
  if (opts.recurring) {
    await sql`update transactions set is_recurring = true where merchant_key = ${tx.merchant_key}`;
  }
  refreshAll();
}

/** "Same purchase?" card. same=true merges the new bank row into the earlier pending/manual one. */
export async function answerDuplicate(id: string, same: boolean) {
  await requireAuth();
  const sql = await db();
  const [row] = await sql<{ id: string; possible_dup_of: string | null }[]>`
    select id, possible_dup_of from transactions where id = ${id}`;
  if (!row?.possible_dup_of) return;
  if (!same) {
    await sql`update transactions set possible_dup_of = null where id = ${id}`;
  } else {
    await sql.begin(async (tx) => {
      const [n] = await tx<{ external_id: string | null; status: string; posted_date: string | null; amount: number; account_id: string | null; description: string }[]>`
        delete from transactions where id = ${id} returning external_id, status, posted_date, amount, account_id, description`;
      await tx`update transactions set
          alt_ids = case when external_id is null then alt_ids else array_append(alt_ids, external_id) end,
          external_id = ${n.external_id}, status = ${n.status}, posted_date = ${n.posted_date},
          amount = ${n.amount}, account_id = ${n.account_id}, last_seen_at = now(), updated_at = now()
        where id = ${row.possible_dup_of!}`;
    });
  }
  refreshAll();
}

export async function answerRecurring(key: string, yes: boolean) {
  await requireAuth();
  const sql = await db();
  await sql`update merchant_rules set recurring = ${yes ? "yes" : "no"}, updated_at = now() where merchant_key = ${key}`;
  if (yes) await sql`update transactions set is_recurring = true where merchant_key = ${key}`;
  refreshAll();
}

export async function setRecurring(key: string, yes: boolean) {
  return answerRecurring(key, yes);
}

// ---------------- transactions ----------------

export async function updateTransaction(id: string, form: FormData) {
  await requireAuth();
  const sql = await db();
  const rawCat = String(form.get("category") || "").trim();
  const purchaseDate = String(form.get("purchase_date") || "");
  const notes = String(form.get("notes") || "") || null;
  const recurring = form.get("recurring") === "on";
  const stupid = form.get("stupid") === "on";
  const description = String(form.get("description") || "").trim();
  const amount = num(form.get("amount"));
  const [tx] = await sql<{ source: string; merchant_key: string; tags: string[]; amount: number }[]>`
    select source, merchant_key, tags, amount from transactions where id = ${id}`;
  if (!tx) redirect("/activity");
  const category = rawCat ? await ensureCategory(rawCat, tx.amount > 0 ? "income" : "spend") : null;
  const tags = [...tx.tags.filter((t) => t !== "stupid"), ...(stupid ? ["stupid"] : [])];
  await sql`update transactions set category = ${category}, notes = ${notes}, is_recurring = ${recurring}, tags = ${tags},
            is_transfer = ${category ? SYSTEM.has(category) : false},
            review = case when ${category}::text is null then review else 'done' end, possible_dup_of = null,
            purchase_date = coalesce(nullif(${purchaseDate}, '')::date, purchase_date), updated_at = now()
            where id = ${id}`;
  if (tx.source === "manual") {
    if (description) await sql`update transactions set description = ${description}, merchant_key = ${merchantKey(description)} where id = ${id}`;
    if (amount != null) await sql`update transactions set amount = ${Math.abs(amount) * (tx.amount > 0 ? 1 : -1)} where id = ${id}`;
  }
  if (category) await learn(tx.merchant_key, category, recurring);
  refreshAll();
  redirect(String(form.get("back") || "/activity"));
}

export async function addManualTransaction(form: FormData) {
  await requireAuth();
  const sql = await db();
  const description = String(form.get("description") || "").trim();
  const amount = num(form.get("amount"));
  if (!description || amount == null) redirect("/activity/new?error=1");
  const isIncome = form.get("is_income") === "on";
  const rawCat = String(form.get("category") || "").trim();
  const category = rawCat ? await ensureCategory(rawCat, isIncome ? "income" : "spend") : null;
  const accountId = String(form.get("account_id") || "") || null;
  const day = String(form.get("purchase_date") || today());
  const key = merchantKey(description);
  await sql`insert into transactions (account_id, amount, description, merchant_key, purchase_date, status, category,
            review, source, is_recurring)
            values (${accountId}, ${isIncome ? Math.abs(amount!) : -Math.abs(amount!)}, ${description}, ${key}, ${day},
            ${accountId ? "pending" : "posted"}, ${category}, ${category ? "done" : "inbox"}, 'manual', ${form.get("recurring") === "on"})`;
  await sql`insert into merchant_rules (merchant_key, label) values (${key}, ${prettyMerchant(description)}) on conflict do nothing`;
  if (category) await learn(key, category, form.get("recurring") === "on" ? true : null);
  refreshAll();
  redirect("/activity");
}

export async function deleteTransaction(id: string) {
  await requireAuth();
  const sql = await db();
  // manual entries are deleted; bank rows are ignored (they'd come back on the next sync)
  await sql`delete from transactions where id = ${id} and source = 'manual'`;
  await sql`update transactions set status = 'dropped', review = 'done' where id = ${id} and source = 'bank'`;
  refreshAll();
  redirect("/activity");
}

// ---------------- plan / categories ----------------

export async function savePlan(form: FormData) {
  await requireAuth();
  const names = form.getAll("fixed_name").map(String);
  const amounts = form.getAll("fixed_amount").map((v) => num(v) ?? 0);
  const fixedCosts: FixedCost[] = names.map((name, i) => ({ name: name.trim(), amount: amounts[i] })).filter((f) => f.name);
  const modes = ["last_month", "avg3", "lowest6", "manual"];
  const mode = String(form.get("income_mode"));
  const plan: Plan = {
    ...(await getPlan()),
    incomeMode: (modes.includes(mode) ? mode : "avg3") as Plan["incomeMode"],
    manualIncome: num(form.get("manual_income")) ?? 0,
    taxPct: Math.min(60, Math.max(0, num(form.get("tax_pct")) ?? 0)),
    fixedCosts,
  };
  await setSetting("plan", plan);
  refreshAll();
}

const SYSTEM = new Set(["Transfer", "Debt Payment"]);

/** Creates a category if it doesn't exist yet. Returns the canonical name (case-insensitive match). */
async function ensureCategory(raw: string, kind: "spend" | "income" = "spend", taxable = false) {
  const name = raw.trim().replace(/\s+/g, " ").slice(0, 40);
  if (!name) return null;
  const sql = await db();
  const [hit] = await sql<{ name: string }[]>`select name from categories where lower(name) = lower(${name})`;
  if (hit) return hit.name;
  const grp = name.includes(" - ") ? name.split(" - ")[0].trim() : name;
  await sql`insert into categories (name, grp, kind, taxable) values (${name}, ${grp}, ${kind}, ${kind === "income" && taxable})
            on conflict do nothing`;
  return name;
}

export async function createCategory(name: string, kind: "spend" | "income", taxable = false) {
  await requireAuth();
  const n = await ensureCategory(name, kind, taxable);
  refreshAll();
  return n;
}

export async function addCategory(form: FormData) {
  await requireAuth();
  const kind = form.get("kind") === "income" ? "income" : "spend";
  await ensureCategory(String(form.get("name") || ""), kind, form.get("taxable") === "on");
  refreshAll();
}

export async function saveCategories(form: FormData) {
  await requireAuth();
  const sql = await db();
  const names = form.getAll("cat").map(String);
  for (const name of names) {
    if (SYSTEM.has(name)) continue;
    const budget = num(form.get(`budget:${name}`)) ?? 0;
    const kind = form.get(`kind:${name}`) === "income" ? "income" : "spend";
    const taxable = kind === "income" && form.get(`taxable:${name}`) === "on";
    await sql`update categories set budget = ${kind === "income" ? 0 : budget}, kind = ${kind}, taxable = ${taxable} where name = ${name}`;
    const rename = String(form.get(`rename:${name}`) || "").trim().replace(/\s+/g, " ").slice(0, 40);
    if (rename && rename !== name && !SYSTEM.has(rename)) {
      const [clash] = await sql`select 1 from categories where lower(name) = lower(${rename}) and name <> ${name}`;
      if (clash) {
        // merging into an existing category
        await sql`update transactions set category = ${rename} where category = ${name}`;
        await sql`update merchant_rules set category = ${rename} where category = ${name}`;
        await sql`delete from categories where name = ${name}`;
      } else {
        const grp = rename.includes(" - ") ? rename.split(" - ")[0].trim() : rename;
        await sql`update categories set name = ${rename}, grp = ${grp} where name = ${name}`;
        await sql`update transactions set category = ${rename} where category = ${name}`;
        await sql`update merchant_rules set category = ${rename} where category = ${name}`;
      }
    }
  }
  refreshAll();
}

export async function deleteCategory(name: string) {
  await requireAuth();
  if (SYSTEM.has(name)) return;
  const sql = await db();
  // anything filed here goes back to the review pile
  await sql`update transactions set category = null, review = 'inbox' where category = ${name}`;
  await sql`update merchant_rules set category = null, confirmations = 0 where category = ${name}`;
  await sql`delete from categories where name = ${name}`;
  refreshAll();
}

// ---------------- accounts ----------------

export async function updateAccount(id: string, form: FormData) {
  await requireAuth();
  const sql = await db();
  const kind = String(form.get("kind") || "checking");
  await sql`update accounts set nickname = ${String(form.get("nickname") || "") || null}, kind = ${kind}, kind_locked = true,
            apr = ${num(form.get("apr"))}, min_payment = ${num(form.get("min_payment"))},
            hidden = ${form.get("hidden") === "on"}, updated_at = now() where id = ${id}`;
  const bal = num(form.get("balance"));
  if (bal != null) {
    const signed = kind === "credit" || kind === "loan" ? -Math.abs(bal) : bal;
    await sql`update accounts set balance = ${signed}, balance_date = now() where id = ${id} and source = 'manual'`;
    await sql`insert into balance_snapshots (account_id, day, balance) values (${id}, ${today()}, ${signed})
              on conflict (account_id, day) do update set balance = excluded.balance`;
  }
  refreshAll();
}

export async function addManualAccount(form: FormData) {
  await requireAuth();
  const sql = await db();
  const name = String(form.get("name") || "").trim();
  if (!name) return;
  const kind = String(form.get("kind") || "loan");
  const bal = num(form.get("balance")) ?? 0;
  const signed = kind === "credit" || kind === "loan" ? -Math.abs(bal) : bal;
  const id = "manual-" + crypto.randomUUID();
  await sql`insert into accounts (id, source, name, kind, kind_locked, balance, balance_date, apr, min_payment)
            values (${id}, 'manual', ${name}, ${kind}, true, ${signed}, now(), ${num(form.get("apr"))}, ${num(form.get("min_payment"))})`;
  await sql`insert into balance_snapshots (account_id, day, balance) values (${id}, ${today()}, ${signed}) on conflict do nothing`;
  refreshAll();
}

export async function deleteAccount(id: string) {
  await requireAuth();
  const sql = await db();
  await sql`delete from accounts where id = ${id} and source = 'manual'`;
  refreshAll();
}
