export function money(n: number, opts: { cents?: boolean; sign?: boolean } = {}) {
  const cents = opts.cents ?? true;
  const s = Math.abs(n).toLocaleString("en-US", {
    style: "currency", currency: "USD", minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0,
  });
  if (n < 0) return "−" + s;
  return opts.sign && n > 0 ? "+" + s : s;
}
