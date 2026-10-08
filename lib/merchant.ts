// Turns messy bank descriptions into a stable "merchant key" so the app can
// remember categories ("NY WATERWAY 0423 WEEHAWKEN NJ" → "ny waterway").

const NOISE_PREFIXES = [
  /^(pos|ach|dbt|debit|credit|card|purchase|recurring|preauthorized|checkcard|visa|mc)\b\s*/,
  /^(debit card purchase|pos purchase|pos debit|card purchase|purchase authorized on \d+\/\d+)\s*/,
  /^(sq|tst|sp|pp|paypal|py|dd|ic|in|bt)\s*\*\s*/,
  /^(apple\.com\/bill|apl\*\s*itunes\.com)\s*/,
];

const STATES =
  /\b(al|ak|az|ar|ca|co|ct|de|fl|ga|hi|id|il|in|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy|dc)$/;

export function merchantKey(description: string): string {
  let s = description.toLowerCase().trim();
  s = s.replace(/https?:\/\/\S+/g, " ");
  for (let i = 0; i < 3; i++) for (const re of NOISE_PREFIXES) s = s.replace(re, "");
  s = s
    .replace(/\*/g, " ")
    .replace(/#\s*\d+/g, " ")
    .replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, " ")
    .replace(/\b[a-z]*\d[a-z\d]*\b/g, " ") // tokens with digits (store #, refs)
    .replace(/[^a-z&' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  let words = s.split(" ").filter(Boolean);
  // drop trailing state code / "usa"
  while (words.length > 1 && (STATES.test(words[words.length - 1]) || words[words.length - 1] === "usa")) {
    words = words.slice(0, -1);
  }
  const key = words.slice(0, 3).join(" ");
  return key || description.toLowerCase().slice(0, 24);
}

/** Pretty label for a merchant key: "ny waterway" → "Ny Waterway" */
export function prettyMerchant(description: string) {
  const k = merchantKey(description);
  return k.replace(/\b\w/g, (c) => c.toUpperCase());
}

function tokens(s: string) {
  return new Set(merchantKey(s).split(" ").filter((w) => w.length > 1));
}

/** 0..1 overlap between two descriptions. */
export function similarity(a: string, b: string) {
  const ka = merchantKey(a);
  const kb = merchantKey(b);
  if (ka && ka === kb) return 1;
  if (ka && kb && (ka.startsWith(kb) || kb.startsWith(ka))) return 0.85;
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.min(ta.size, tb.size);
}

const TRANSFER_RE =
  /\b(payment thank you|autopay|auto pay|online payment|mobile payment|epay|e-payment|ach pmt|pymt|crd pmt|card pmt|transfer|xfer|to savings|from savings|to checking|from checking|applecard gsbank payment|discover e-payment|chase credit crd|capital one.*pmt|sofi.*(transfer|money))\b/i;

export function looksLikeTransfer(description: string) {
  // person-to-person payments are real spending (e.g. Zelle to a friend for rent share)
  if (/\b(zelle|venmo|cash app|cashapp|paypal)\b/i.test(description)) return false;
  return TRANSFER_RE.test(description);
}

const INCOME_RE = /\b(payroll|direct dep|dir dep|salary|paycheck|irs treas|tax ref|interest paid|interest earned)\b/i;
export function looksLikeIncome(description: string) {
  return INCOME_RE.test(description);
}

const INTEREST_RE = /\b(interest charge|purchase interest|late fee|annual fee|finance charge|overdraft)\b/i;
export function looksLikeFee(description: string) {
  return INTEREST_RE.test(description);
}
