import { ClientApp } from "@/components/ClientApp";
import { apiEndpoint } from "@/lib/xai/endpoint";

// Rendered per request, so browsers never keep a page whose scripts an older deploy removed,
// and the key wording follows XAI_BASE_URL from the first paint.
export const dynamic = "force-dynamic";

export default function Page() {
  return <ClientApp endpoint={apiEndpoint()} />;
}
