import { uploadLimits } from "@/lib/upload-limits";
import { apiEndpoint } from "@/lib/xai/endpoint";

export const dynamic = "force-dynamic";

/**
 * What the UI needs to know about this server: whether it has a fallback E2B key (without revealing it),
 * the upload sizes it accepts, and which API host it sends model requests to (custom when XAI_BASE_URL is set).
 */
export function GET() {
  return Response.json({
    e2bServerKey: Boolean(process.env.E2B_API_KEY?.trim()),
    uploads: uploadLimits(),
    endpoint: apiEndpoint(),
  });
}
