"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "Home", icon: "M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" },
  { href: "/review", label: "Review", icon: "M5 4h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm14 3 2 1v10a3 3 0 0 1-3 3h-9" },
  { href: "/activity", label: "Activity", icon: "M4 6h16M4 12h16M4 18h10" },
  { href: "/payoff", label: "Payoff", icon: "M4 19 9 13l4 3 7-9M15 7h5v5" },
  { href: "/accounts", label: "Accounts", icon: "M3 9h18v10H3zM3 9l9-5 9 5M7 13v3m5-3v3m5-3v3" },
];

export default function BottomNav({ inbox }: { inbox: number }) {
  const path = usePathname();
  return (
    <nav className="fixed bottom-0 inset-x-0 z-40 border-t border-line bg-paper/90 backdrop-blur-md"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      <ul className="mx-auto max-w-lg grid grid-cols-5">
        {items.map((it) => {
          const on = it.href === "/" ? path === "/" : path.startsWith(it.href);
          return (
            <li key={it.href}>
              <Link href={it.href} className={`relative flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium ${on ? "text-ink" : "text-muted"}`}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={on ? 2.2 : 1.7} strokeLinecap="round" strokeLinejoin="round"><path d={it.icon} /></svg>
                {it.label}
                {it.href === "/review" && inbox > 0 && (
                  <span className="absolute top-1.5 left-1/2 ml-2 min-w-[18px] h-[18px] px-1 rounded-full bg-bad text-white text-[10px] font-bold flex items-center justify-center num">
                    {inbox > 99 ? "99+" : inbox}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
