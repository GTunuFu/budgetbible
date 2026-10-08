import "server-only";
import postgres from "postgres";

declare global {
  // eslint-disable-next-line no-var
  var __bbSql: ReturnType<typeof postgres> | undefined;
  // eslint-disable-next-line no-var
  var __bbSchema: Promise<void> | undefined;
}

function client() {
  if (!globalThis.__bbSql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    const local = /localhost|127\.0\.0\.1/.test(url);
    globalThis.__bbSql = postgres(url, {
      max: 5,
      prepare: false, // works with Neon's pooled connections
      ssl: local ? false : "require",
      idle_timeout: 20,
      types: {
        // return NUMERIC as JS numbers (money values are small enough)
        numeric: {
          to: 1700,
          from: [1700],
          serialize: (x: number) => String(x),
          parse: (x: string) => Number(x),
        },
        // keep DATE columns as plain "YYYY-MM-DD" strings (no timezone shifts)
        date: {
          to: 1082,
          from: [1082],
          serialize: (x: string) => x,
          parse: (x: string) => x,
        },
      },
    });
  }
  return globalThis.__bbSql;
}

const SCHEMA: string[] = [
  `create table if not exists settings (
     key text primary key,
     value jsonb not null
   )`,
  `create table if not exists accounts (
     id text primary key,
     source text not null default 'manual',
     org_name text,
     name text not null,
     nickname text,
     kind text not null default 'checking',
     balance numeric not null default 0,
     available numeric,
     balance_date timestamptz,
     apr numeric,
     min_payment numeric,
     hidden boolean not null default false,
     kind_locked boolean not null default false,
     updated_at timestamptz not null default now()
   )`,
  `create table if not exists categories (
     name text primary key,
     grp text not null,
     budget numeric not null default 0,
     sort int not null default 100,
     kind text not null default 'spend'
   )`,
  `create table if not exists transactions (
     id uuid primary key default gen_random_uuid(),
     account_id text references accounts(id) on delete cascade,
     external_id text unique,
     alt_ids text[] not null default '{}',
     amount numeric not null,
     description text not null,
     merchant_key text not null default '',
     purchase_date date not null,
     posted_date date,
     status text not null default 'posted',
     category text,
     tags text[] not null default '{}',
     is_recurring boolean not null default false,
     is_transfer boolean not null default false,
     review text not null default 'inbox',
     source text not null default 'bank',
     possible_dup_of uuid,
     merged_into uuid,
     notes text,
     last_seen_at timestamptz,
     created_at timestamptz not null default now(),
     updated_at timestamptz not null default now()
   )`,
  `alter table categories add column if not exists taxable boolean not null default false`,
  `create index if not exists tx_purchase_date on transactions (purchase_date)`,
  `create index if not exists tx_review on transactions (review)`,
  `create index if not exists tx_merchant on transactions (merchant_key)`,
  `create table if not exists merchant_rules (
     merchant_key text primary key,
     label text,
     category text,
     confirmations int not null default 0,
     recurring text not null default 'unknown',
     updated_at timestamptz not null default now()
   )`,
  `create table if not exists balance_snapshots (
     account_id text references accounts(id) on delete cascade,
     day date not null,
     balance numeric not null,
     primary key (account_id, day)
   )`,
  `create table if not exists sync_log (
     id serial primary key,
     ran_at timestamptz not null default now(),
     ok boolean not null,
     summary jsonb
   )`,
];

// Only the two built-in categories the sync engine relies on. Everything else you create as you go.
const SYSTEM_CATEGORIES: [string, string, number, string][] = [
  ["Debt Payment", "System", 900, "transfer"],
  ["Transfer", "System", 901, "transfer"],
];

async function migrate() {
  const sql = client();
  await sql`create extension if not exists pgcrypto`.catch(() => {});
  for (const stmt of SCHEMA) await sql.unsafe(stmt);
  for (const [name, grp, sort, kind] of SYSTEM_CATEGORIES) {
    await sql`insert into categories (name, grp, sort, kind) values (${name}, ${grp}, ${sort}, ${kind}) on conflict do nothing`;
  }
}

/** Returns a ready-to-use SQL client; creates tables on first use. */
export async function db() {
  const sql = client();
  if (!globalThis.__bbSchema) {
    globalThis.__bbSchema = migrate().catch((e) => {
      globalThis.__bbSchema = undefined;
      throw e;
    });
  }
  await globalThis.__bbSchema;
  return sql;
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const sql = await db();
  const rows = await sql<{ value: T }[]>`select value from settings where key = ${key}`;
  return rows.length ? rows[0].value : fallback;
}

export async function setSetting(key: string, value: unknown) {
  const sql = await db();
  await sql`insert into settings (key, value) values (${key}, ${sql.json(value as never)})
            on conflict (key) do update set value = excluded.value`;
}
