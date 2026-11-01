import { notFound } from "next/navigation";
import { AdminUsers } from "@/components/AdminUsers";
import { authEnabled, defaultDailyLimit, signupOpen } from "@/lib/auth/config";
import { accountFromCookies } from "@/lib/auth/session";
import { listUsers } from "@/lib/auth/users";

export const dynamic = "force-dynamic";

export const metadata = { title: "Accounts" };

export default async function AdminPage() {
  if (!authEnabled()) notFound();
  const me = await accountFromCookies().catch(() => null);
  // Anyone who is not an admin sees the same 404 as a stranger.
  if (!me?.admin || me.disabled) notFound();
  return <AdminUsers initial={await listUsers()} meId={me.id} defaultLimit={defaultDailyLimit()} openSignup={signupOpen()} />;
}
