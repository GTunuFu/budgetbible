import "server-only";
import { db, getSetting, setSetting } from "./db";
import { decrypt } from "./crypto";
import { fetchAccounts, type SfAccount, type SfAccountSet, type SfTransaction } from "./simplefin";
import { looksLikeFee, looksLikeIncome, looksLikeTransfer, merchantKey, prettyMerchant, similarity } from "./merchant";
import { addDays, dayOf, diffDays, today } from "./dates";
import { detectRecurring } from "./recurring";

export type SyncSummary = {
  accounts: number;
  added: number;
  updated: number;
  merged: number;
  questions: number;
  dropped: number;
  transfers: number;
  autoFiled: number;
  warnings: string[];
};

type Row = {
  id: string;
  account_id: string | null;
  external_id: string | null;
  amount: number;
  description: string;
  purchase_date: string;
  status: string;
  source: string;
  merged_into: string | null;
};

function inferKind(name: string, balance: number) {
  const n = name.toLowerCase();
  if (/loan|student|nelnet|mohela|navient|aidvantage|sallie|edfinancial|mortgage/.test(n)) return "loan";
  if (/card|credit|freedom|sapphire|prime|discover it|platinum|quicksilver|venture|savor|amex|visa|mastercard/.test(n))
    return "credit";
  if (/saving|vault|high.?yield|hysa/.test(n)) return "savings";
  if (balance < 0) return "credit";
  return "checking";
}

const isPending = (t: SfTransaction) => t.pending === true || !t.posted;

/** Pulls from SimpleFIN using the stored access URL and merges into the database. */
export async function syncFromSimpleFin(): Promise<SyncSummary> {
  const blob = await getSetting<string | null>("simplefin_access", null);
  if (!blob) throw new Error("SimpleFIN is not connected yet.");
  const last = await getSetting<string | null>("last_sync_at", null);
  const now = Date.now();
  const maxBack = now - 89 * 86400000;
  // overlap previous window by 10 days so late-posting items are caught
  const start = last ? Math.max(Date.parse(last) - 10 * 86400000, maxBack) : maxBack;
  const data = await fetchAccounts(decrypt(blob), new Date(start));
  return ingest(data);
}

/** Merge a SimpleFIN account set into the database. Exported for testing. */
export async function ingest(data: SfAccountSet): Promise<SyncSummary> {
  const sql = await db();
  const runStarted = new Date();
  const s: SyncSummary = {
    accounts: 0, added: 0, updated: 0, merged: 0, questions: 0, dropped: 0, transfers: 0, autoFiled: 0,
    warnings: [],
  };
  for (const e of data.errlist ?? []) s.warnings.push(e.msg);
  for (const e of data.errors ?? []) s.warnings.push(e);

  const connName = new Map((data.connections ?? []).map((c) => [c.conn_id, c.name]));
  const rules = new Map(
    (await sql<{ merchant_key: string; category: string | null; confirmations: number; recurring: string }[]>`
      select merchant_key, category, confirmations, recurring from merchant_rules`).map((r) => [r.merchant_key, r]),
  );

  for (const acct of data.accounts) {
    await upsertAccount(acct, connName.get(acct.conn_id ?? "") ?? acct.org?.name ?? null);
    s.accounts++;

    const txs = [...(acct.transactions ?? [])];
    const pendingIdsInFeed = new Set(txs.filter(isPending).map((t) => t.id));
    // pending first so a posted item arriving in the same batch can merge into it
    txs.sort((a, b) => Number(isPending(b)) - Number(isPending(a)));

    for (const t of txs) {
      const pending = isPending(t);
      const amount = Number(t.amount);
      const description = (t.description || t.payee || "Unknown").trim();
      const purchaseDay = dayOf(t.transacted_at || t.posted || Math.floor(Date.now() / 1000));
      const postedDay = pending ? null : dayOf(t.posted);

      const [existing] = await sql<Row[]>`
        select * from transactions where external_id = ${t.id} or ${t.id} = any(alt_ids) limit 1`;

      if (existing) {
        if (existing.merged_into) continue;
        if (pending) {
          await sql`update transactions set amount = ${amount}, last_seen_at = now(), updated_at = now()
                    where id = ${existing.id} and status = 'pending'`;
        } else {
          await sql`update transactions set status = 'posted', posted_date = ${postedDay}, amount = ${amount},
                    last_seen_at = now(), updated_at = now() where id = ${existing.id}`;
        }
        s.updated++;
        continue;
      }

      // ---- New transaction. If it just posted, try to find the pending/manual row it replaces.
      if (!pending) {
        const match = await findMatch(acct.id, amount, description, postedDay!, purchaseDay, pendingIdsInFeed);
        if (match && match.auto) {
          await sql`
            update transactions set
              alt_ids = case when external_id is null then alt_ids else array_append(alt_ids, external_id) end,
              external_id = ${t.id}, status = 'posted', posted_date = ${postedDay}, amount = ${amount},
              account_id = ${acct.id}, last_seen_at = now(), updated_at = now(),
              merchant_key = case when source = 'manual' then merchant_key else ${merchantKey(description)} end,
              description = case when source = 'manual' then description else ${description} end
            where id = ${match.row.id}`;
          s.merged++;
          continue;
        }
        if (match) s.questions++;
        await insertNew(t.id, acct.id, amount, description, purchaseDay, postedDay, "posted", match?.row.id ?? null);
      } else {
        await insertNew(t.id, acct.id, amount, description, purchaseDay, null, "pending", null);
      }
      s.added++;
    }

    // balance snapshot (one per day)
    await sql`insert into balance_snapshots (account_id, day, balance) values (${acct.id}, ${today()}, ${Number(acct.balance)})
              on conflict (account_id, day) do update set balance = excluded.balance`;
  }

  // Pending items the bank stopped reporting (holds released, or reposted under a different amount)
  const feedAccounts = data.accounts.map((a) => a.id);
  if (feedAccounts.length) {
    const dropped = await sql`
      update transactions set status = 'dropped', review = 'done', updated_at = now()
      where status = 'pending' and source = 'bank' and merged_into is null
        and account_id = any(${feedAccounts}) and (last_seen_at is null or last_seen_at < ${runStarted})
      returning id`;
    s.dropped = dropped.length;
  }

  s.transfers = await pairTransfers();
  s.autoFiled = await countAutoFiled(runStarted);
  await detectRecurring();

  await setSetting("last_sync_at", new Date().toISOString());
  await sql`insert into sync_log (ok, summary) values (true, ${sql.json(s as never)})`;
  return s;

  // ---------- helpers (closures share sql + rules) ----------

  async function upsertAccount(a: SfAccount, org: string | null) {
    const bal = Number(a.balance);
    const avail = a["available-balance"] != null ? Number(a["available-balance"]) : null;
    const kind = inferKind(a.name, bal);
    await sql`
      insert into accounts (id, source, org_name, name, kind, balance, available, balance_date, updated_at)
      values (${a.id}, 'simplefin', ${org}, ${a.name}, ${kind}, ${bal}, ${avail}, to_timestamp(${a["balance-date"]}), now())
      on conflict (id) do update set
        org_name = excluded.org_name, name = excluded.name, balance = excluded.balance,
        available = excluded.available, balance_date = excluded.balance_date, updated_at = now(),
        kind = case when accounts.kind_locked then accounts.kind else excluded.kind end`;
  }

  async function findMatch(
    accountId: string,
    amount: number,
    description: string,
    postedDay: string,
    purchaseDay: string,
    pendingIdsInFeed: Set<string>,
  ): Promise<{ row: Row; auto: boolean } | null> {
    const lo = addDays(purchaseDay, -10);
    const hi = addDays(postedDay, 2);
    const candidates = await sql<Row[]>`
      select * from transactions
      where merged_into is null and possible_dup_of is null
        and (
          (source = 'bank' and status = 'pending' and account_id = ${accountId})
          or (source = 'manual' and external_id is null and (account_id is null or account_id = ${accountId}))
        )
        and purchase_date between ${lo} and ${hi}
        and sign(amount) = sign(${amount}::numeric)`;
    let best: { row: Row; score: number; auto: boolean } | null = null;
    for (const c of candidates) {
      // a pending row the bank is still reporting is a different purchase
      if (c.source === "bank" && c.external_id && pendingIdsInFeed.has(c.external_id)) continue;
      const sim = similarity(c.description, description);
      const exact = Math.abs(c.amount - amount) < 0.005;
      const ratio = Math.abs(amount) / Math.max(Math.abs(c.amount), 0.01);
      const close = ratio >= 0.95 && ratio <= 1.3; // tips / final gas amounts
      const dayGap = Math.abs(diffDays(c.purchase_date, purchaseDay));
      let score = 0;
      let auto = false;
      if (exact && sim >= 0.5) { score = 3 + sim; auto = true; }
      else if (close && sim >= 0.7 && c.source === "bank") { score = 2.5 + sim; auto = true; }
      else if (exact) { score = 2 + sim; }
      else if (close && sim >= 0.4) { score = 1 + sim; }
      else continue;
      score -= dayGap * 0.02;
      if (!best || score > best.score) best = { row: c, score, auto };
    }
    return best ? { row: best.row, auto: best.auto } : null;
  }

  async function insertNew(
    externalId: string, accountId: string, amount: number, description: string,
    purchaseDay: string, postedDay: string | null, status: string, dupOf: string | null,
  ) {
    const key = merchantKey(description);
    const rule = rules.get(key);
    let category: string | null = rule?.category ?? null;
    let review = "inbox";
    let isTransfer = false;
    if (looksLikeTransfer(description)) {
      isTransfer = true; review = "done";
      category = /crd|card|credit|loan|payment thank|applecard|e-payment/i.test(description) ? "Debt Payment" : "Transfer";
    } else if (!category && amount > 0 && looksLikeIncome(description)) {
      category = "Income";
    } else if (!category && amount < 0 && looksLikeFee(description)) {
      category = "Fees & Interest";
    }
    if (!isTransfer && rule?.category && rule.confirmations >= 3) review = "done"; // learned merchant
    if (dupOf) review = "inbox";
    await sql`
      insert into transactions (account_id, external_id, amount, description, merchant_key, purchase_date, posted_date,
        status, category, is_recurring, is_transfer, review, source, possible_dup_of, last_seen_at)
      values (${accountId}, ${externalId}, ${amount}, ${description}, ${key}, ${purchaseDay}, ${postedDay},
        ${status}, ${category}, ${rule?.recurring === "yes"}, ${isTransfer}, ${review}, 'bank', ${dupOf}, now())`;
    if (!rule) {
      await sql`insert into merchant_rules (merchant_key, label) values (${key}, ${prettyMerchant(description)})
                on conflict do nothing`;
      rules.set(key, { merchant_key: key, category: null, confirmations: 0, recurring: "unknown" });
    }
  }

  async function countAutoFiled(since: Date) {
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int n from transactions
      where created_at >= ${since} and review = 'done' and not is_transfer and category is not null`;
    return n;
  }
}

/** Card payments show up twice (−$500 in checking, +$500 on the card). Mark both as transfers. */
export async function pairTransfers() {
  const sql = await db();
  const rows = await sql<{ id: string; account_id: string; amount: number; purchase_date: string; kind: string }[]>`
    select t.id, t.account_id, t.amount, t.purchase_date, a.kind from transactions t
    join accounts a on a.id = t.account_id
    where not t.is_transfer and t.merged_into is null and t.status <> 'dropped'
      and t.purchase_date >= ${addDays(today(), -60)}
    order by t.purchase_date`;
  const used = new Set<string>();
  let pairs = 0;
  for (const inflow of rows) {
    if (inflow.amount <= 0 || used.has(inflow.id)) continue;
    if (inflow.kind !== "credit" && inflow.kind !== "loan" && inflow.kind !== "savings") continue;
    const out = rows.find(
      (o) => !used.has(o.id) && o.amount < 0 && o.account_id !== inflow.account_id &&
        Math.abs(o.amount + inflow.amount) < 0.005 && Math.abs(diffDays(o.purchase_date, inflow.purchase_date)) <= 4,
    );
    if (!out) continue;
    used.add(inflow.id); used.add(out.id);
    const cat = inflow.kind === "savings" ? "Transfer" : "Debt Payment";
    await sql`update transactions set is_transfer = true, category = ${cat}, review = 'done', possible_dup_of = null, updated_at = now()
              where id in (${inflow.id}, ${out.id})`;
    pairs++;
  }
  return pairs;
}
