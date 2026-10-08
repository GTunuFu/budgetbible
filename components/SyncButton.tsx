"use client";
import { useState, useTransition } from "react";
import { syncNow } from "@/app/actions";

export default function SyncButton({ lastSync, connected }: { lastSync: string | null; connected: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  if (!connected) return null;
  return (
    <div className="text-right">
      <button
        onClick={() => start(async () => setMsg(await syncNow()))}
        disabled={pending}
        className="text-xs text-muted inline-flex items-center gap-1.5 active:opacity-60"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
          className={pending ? "animate-spin" : ""}><path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5" /></svg>
        {pending ? "Syncing…" : lastSync ? `Synced ${ago(lastSync)}` : "Sync now"}
      </button>
      {msg && <div className={`text-[11px] mt-0.5 ${msg.ok ? "text-muted" : "text-bad"}`}>{msg.message}</div>}
    </div>
  );
}

function ago(iso: string) {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
