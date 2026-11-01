import { AuthGate } from "@/components/AuthGate";
import { ClientApp } from "@/components/ClientApp";
import { authInfo } from "@/lib/auth/info";
import { apiEndpoint } from "@/lib/xai/endpoint";

// Rendered per request, so browsers never keep a page whose scripts an older deploy removed,
// the key wording follows XAI_BASE_URL from the first paint, and the sign-in state is never stale.
export const dynamic = "force-dynamic";

export default async function Page() {
  const auth = await authInfo();
  if (auth.required && !auth.account) return <AuthGate auth={auth} />;
  return <ClientApp endpoint={apiEndpoint()} auth={auth} />;
}
