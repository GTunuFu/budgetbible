"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { answerDuplicate, answerRecurring, fileTransaction } from "@/app/actions";
import { money } from "@/lib/format";

type CardTx = {
  id: string; amount: number; description: string; merchant: string; purchaseDate: string; postedDate: string | null;
  status: string; account: string; category: string | null; recurring: boolean; stupid: boolean; source: string;
  merchantKey: string;
};

export type DeckCard =
  | { type: "tx"; key: string; tx: CardTx }
  | { type: "dup"; key: string; tx: CardTx; original: CardTx }
  | { type: "recurring"; key: string; merchantKey: string; label: string; amount: number; count: number; lastDay: string };

const fmtDay = (d: string) =>
  new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

export default function SwipeDeck({ initial, categories }: { initial: DeckCard[]; categories: { name: string; kind: string }[] }) {
  const [deck, setDeck] = useState(initial);
  const [done, setDone] = useState(0);
  const [, start] = useTransition();
  const top = deck[0];

  // per-card selections (category / toggles) for the top tx card
  const [sel, setSel] = useState<{ key: string; category: string | null; recurring: boolean; stupid: boolean } | null>(null);
  const current =
    top && (top.type === "tx") && sel?.key === top.key
      ? sel
      : top && top.type === "tx"
        ? { key: top.key, category: top.tx.category, recurring: top.tx.recurring, stupid: top.tx.stupid }
        : null;

  const [dx, setDx] = useState(0);
  const [flying, setFlying] = useState<0 | 1 | -1>(0);
  const [shake, setShake] = useState(false);
  const startX = useRef<number | null>(null);

  // apply what was just learned to the rest of the deck (same merchant → same suggestion)
  function teach(merchantKey: string, patch: Partial<CardTx>) {
    setDeck((d) => d.map((c) => (c.type === "tx" && c.tx.merchantKey === merchantKey
      ? { ...c, tx: { ...c.tx, ...(patch.category && c.tx.category ? { ...patch, category: c.tx.category } : patch) } } : c)));
  }

  function file(card: Extract<DeckCard, { type: "tx" }>, category: string, recurring: boolean, stupid: boolean) {
    const changed = recurring !== card.tx.recurring;
    teach(card.tx.merchantKey, { category, ...(changed ? { recurring } : {}) });
    start(() => fileTransaction(card.tx.id, category, { recurring: changed ? recurring : undefined, stupid }));
  }

  function advance(later = false) {
    setDeck((d) => (later && d.length > 1 ? [...d.slice(1), d[0]] : d.slice(1)));
    if (!later) setDone((n) => n + 1);
    setDx(0); setFlying(0); setSel(null);
  }

  function fly(dir: 1 | -1, after: () => void) {
    setFlying(dir);
    setTimeout(after, 180);
  }

  function right() {
    if (!top) return;
    if (top.type === "tx") {
      if (!current?.category) { setShake(true); setTimeout(() => setShake(false), 400); setDx(0); return; }
      const { category, recurring, stupid } = current;
      fly(1, () => { advance(); file(top, category!, recurring, stupid); });
    } else if (top.type === "dup") {
      fly(1, () => { advance(); start(() => answerDuplicate(top.tx.id, true)); });
    } else {
      fly(1, () => { advance(); teach(top.merchantKey, { recurring: true }); start(() => answerRecurring(top.merchantKey, true)); });
    }
  }

  function left() {
    if (!top) return;
    if (top.type === "tx") fly(-1, () => advance(true));
    else if (top.type === "dup") fly(-1, () => { advance(); start(() => answerDuplicate(top.tx.id, false)); });
    else fly(-1, () => { advance(); start(() => answerRecurring(top.merchantKey, false)); });
  }

  function pickCategory(name: string) {
    if (!top || top.type !== "tx" || !current) return;
    const next = { ...current, category: name };
    setSel(next);
    fly(1, () => { advance(); file(top, name, next.recurring, next.stupid); });
  }

  if (!top) {
    return (
      <div className="card p-8 text-center">
        <div className="figure text-4xl mb-2">All clear.</div>
        <p className="text-muted text-sm mb-5">{done > 0 ? `You filed ${done} just now.` : "Nothing waiting to be categorized."}</p>
        <Link href="/" className="btn">Back to dashboard</Link>
      </div>
    );
  }

  const offset = flying ? flying * 600 : dx;
  const rot = offset / 18;
  const hint = offset > 40 ? "right" : offset < -40 ? "left" : null;
  const labels =
    top.type === "tx" ? { left: "Later", right: current?.category ? `File · ${current.category}` : "Pick a category" }
    : top.type === "dup" ? { left: "Different", right: "Same purchase" }
    : { left: "Not recurring", right: "Recurring" };

  return (
    <div className="select-none">
      <div className="flex justify-between text-xs text-muted mb-2 num">
        <span>{deck.length} left</span>
        <span>← {labels.left} · {labels.right} →</span>
      </div>

      <div className="relative h-[220px]">
        {deck[1] && (
          <div className="absolute inset-0 card scale-[0.96] translate-y-2 opacity-60" aria-hidden />
        )}
        <div
          key={top.key}
          className={`absolute inset-0 card p-5 touch-none cursor-grab shadow-[0_8px_30px_rgba(0,0,0,0.08)] ${shake ? "animate-[wiggle_0.4s]" : ""}`}
          style={{
            transform: `translateX(${offset}px) rotate(${rot}deg)`,
            transition: startX.current == null ? "transform 180ms ease-out" : "none",
          }}
          onPointerDown={(e) => { startX.current = e.clientX; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); }}
          onPointerMove={(e) => { if (startX.current != null) setDx(e.clientX - startX.current); }}
          onPointerUp={() => {
            const d = dx; startX.current = null;
            if (d > 100) right(); else if (d < -100) left(); else setDx(0);
          }}
          onPointerCancel={() => { startX.current = null; setDx(0); }}
        >
          {hint && (
            <div className={`absolute top-4 ${hint === "right" ? "left-4 bg-accent" : "right-4 bg-muted"} text-paper text-xs font-bold px-2 py-1 rounded-md uppercase tracking-wide`}>
              {hint === "right" ? labels.right : labels.left}
            </div>
          )}
          {top.type === "tx" && <TxFace tx={top.tx} />}
          {top.type === "dup" && <DupFace tx={top.tx} original={top.original} />}
          {top.type === "recurring" && (
            <div className="h-full flex flex-col justify-center text-center">
              <div className="eyebrow mb-2">Recurring charge?</div>
              <div className="text-xl font-semibold">{top.label}</div>
              <div className="figure text-5xl my-3">{money(top.amount)}</div>
              <div className="text-sm text-muted">Seen {top.count}× about a month apart · last {fmtDay(top.lastDay)}</div>
              <div className="text-xs text-muted mt-3">Recurring charges are set aside before your safe-to-spend.</div>
            </div>
          )}
        </div>
      </div>

      {top.type === "tx" && current && (
        <div className="mt-5 space-y-3">
          <div className="flex gap-2">
            <button className="chip" data-on={current.recurring} onClick={() => setSel({ ...current, recurring: !current.recurring })}>
              ↻ Recurring
            </button>
            <button className="chip" data-on={current.stupid} onClick={() => setSel({ ...current, stupid: !current.stupid })}>
              Stupid buy
            </button>
          </div>
          <div className="eyebrow">Tap a category to file</div>
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <button key={c.name} className="chip" data-on={current.category === c.name} onClick={() => pickCategory(c.name)}>
                {c.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 mt-5">
        <button className="btn btn-ghost" onClick={left}>{labels.left}</button>
        <button className="btn" onClick={right}>{top.type === "tx" ? "File it" : labels.right}</button>
      </div>
      <style>{`@keyframes wiggle{0%,100%{transform:translateX(0)}25%{transform:translateX(-8px)}75%{transform:translateX(8px)}}`}</style>
    </div>
  );
}

function TxFace({ tx }: { tx: CardTx }) {
  const income = tx.amount > 0;
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between text-xs text-muted">
        <span>{tx.account}</span>
        <StatusBadge tx={tx} />
      </div>
      <div className="flex-1 flex flex-col justify-center text-center">
        <div className="text-xl font-semibold leading-tight">{tx.merchant}</div>
        <div className={`figure text-[48px] leading-none my-2 ${income ? "text-accent" : ""}`}>
          {income ? "+" : ""}{money(Math.abs(tx.amount))}
        </div>
        <div className="text-sm text-muted">Bought {fmtDay(tx.purchaseDate)}</div>
      </div>
      <div className="text-[11px] text-muted truncate text-center">{tx.description}</div>
    </div>
  );
}

function StatusBadge({ tx }: { tx: CardTx }) {
  if (tx.status === "pending")
    return <span className="px-2 py-0.5 rounded-full bg-warn-soft text-warn font-semibold">{tx.source === "manual" ? "Logged by you" : "Pending"}</span>;
  return (
    <span className="px-2 py-0.5 rounded-full bg-accent-soft text-accent font-semibold">
      Posted{tx.postedDate && tx.postedDate !== tx.purchaseDate ? ` ${fmtDay(tx.postedDate).replace(/^\w+, /, "")}` : ""}
    </span>
  );
}

function DupFace({ tx, original }: { tx: CardTx; original: CardTx }) {
  return (
    <div className="h-full flex flex-col">
      <div className="eyebrow text-center">Same purchase?</div>
      <p className="text-xs text-muted text-center mt-1">The bank posted something that looks like one you already have.</p>
      <div className="grid grid-cols-2 gap-3 mt-4 flex-1">
        {[original, tx].map((t, i) => (
          <div key={t.id} className="rounded-xl bg-paper p-3 flex flex-col">
            <div className="text-[11px] text-muted mb-1">{i === 0 ? (t.source === "manual" ? "You logged" : "Was pending") : "Just posted"}</div>
            <div className="font-semibold text-sm leading-tight line-clamp-2">{t.merchant}</div>
            <div className="figure text-2xl mt-auto">{money(Math.abs(t.amount))}</div>
            <div className="text-[11px] text-muted">{fmtDay(i === 0 ? t.purchaseDate : t.postedDate ?? t.purchaseDate)}</div>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-muted text-center mt-3">Same = keep one, with the original date and category.</p>
    </div>
  );
}
