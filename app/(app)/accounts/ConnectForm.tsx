"use client";
import { useActionState } from "react";
import { connectSimpleFin } from "@/app/actions";

export default function ConnectForm() {
  const [error, action, pending] = useActionState(connectSimpleFin, null);
  return (
    <form action={action} className="space-y-2">
      <textarea name="token" rows={3} required className="field font-mono !text-xs" placeholder="Paste SimpleFIN setup token" />
      {error && <p className="text-sm text-bad">{error}</p>}
      <button className="btn w-full" disabled={pending}>{pending ? "Connecting and pulling 90 days…" : "Connect"}</button>
    </form>
  );
}
