import { uploadLimits } from "@/lib/upload-limits";

export const dynamic = "force-dynamic";

/** Whether the server has a fallback E2B key (without revealing it) and the upload sizes it accepts. */
export function GET() {
  return Response.json({ e2bServerKey: Boolean(process.env.E2B_API_KEY?.trim()), uploads: uploadLimits() });
}
