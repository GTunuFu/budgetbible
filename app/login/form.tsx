"use client";
import { useActionState } from "react";
import { login } from "../actions";

export default function LoginForm() {
  const [error, action, pending] = useActionState(login, null);
  return (
    <form action={action} className="space-y-3">
      <input className="field" type="password" name="password" placeholder="Password" autoComplete="current-password" autoFocus required />
      {error && <p className="text-sm text-bad">{error}</p>}
      <button className="btn w-full" disabled={pending}>{pending ? "Checking…" : "Open"}</button>
    </form>
  );
}
