import BottomNav from "@/components/BottomNav";
import { getInboxCount } from "@/lib/data";
import { requireAuth } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireAuth();
  const inbox = await getInboxCount();
  return (
    <>
      <div className="mx-auto max-w-lg px-4 safe-bottom" style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}>
        {children}
      </div>
      <BottomNav inbox={inbox} />
    </>
  );
}
