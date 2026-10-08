import "server-only";

// SimpleFIN protocol: https://www.simplefin.org/protocol.html
export type SfTransaction = {
  id: string;
  posted: number; // unix seconds, may be 0 when pending
  amount: string;
  description: string;
  payee?: string;
  memo?: string;
  transacted_at?: number;
  pending?: boolean;
};

export type SfAccount = {
  id: string;
  name: string;
  conn_id?: string;
  org?: { name?: string; domain?: string };
  currency: string;
  balance: string;
  "available-balance"?: string;
  "balance-date": number;
  transactions?: SfTransaction[];
};

export type SfAccountSet = {
  errlist?: { code: string; msg: string }[];
  errors?: string[];
  connections?: { conn_id: string; name: string; org_id?: string }[];
  accounts: SfAccount[];
};

/** Exchanges a one-time SimpleFIN setup token for a permanent access URL. */
export async function claimSetupToken(setupToken: string): Promise<string> {
  const trimmed = setupToken.trim();
  let claimUrl: string;
  try {
    claimUrl = Buffer.from(trimmed, "base64").toString("utf8").trim();
    new URL(claimUrl);
  } catch {
    throw new Error("That doesn't look like a SimpleFIN setup token.");
  }
  if (!claimUrl.startsWith("https://")) throw new Error("Setup token must decode to an https URL.");
  const res = await fetch(claimUrl, { method: "POST", headers: { "Content-Length": "0" }, cache: "no-store" });
  if (res.status === 403) {
    throw new Error("SimpleFIN says this token was already used or doesn't exist. Generate a fresh one.");
  }
  if (!res.ok) throw new Error(`SimpleFIN claim failed (${res.status}).`);
  const accessUrl = (await res.text()).trim();
  new URL(accessUrl); // validate
  return accessUrl;
}

/** Fetch accounts + transactions. Window is capped at 90 days by SimpleFIN Bridge. */
export async function fetchAccounts(accessUrl: string, startDate: Date): Promise<SfAccountSet> {
  const u = new URL(accessUrl);
  const user = decodeURIComponent(u.username);
  const pass = decodeURIComponent(u.password);
  u.username = "";
  u.password = "";
  const base = u.toString().replace(/\/$/, "");
  const start = Math.floor(startDate.getTime() / 1000);
  const url = `${base}/accounts?version=2&pending=1&start-date=${start}`;
  const res = await fetch(url, {
    headers: { Authorization: "Basic " + Buffer.from(`${user}:${pass}`).toString("base64") },
    cache: "no-store",
  });
  if (res.status === 403) throw new Error("SimpleFIN access was revoked or credentials are wrong. Reconnect in Accounts.");
  if (res.status === 402) throw new Error("SimpleFIN subscription needs payment.");
  if (!res.ok) throw new Error(`SimpleFIN request failed (${res.status}).`);
  return (await res.json()) as SfAccountSet;
}
