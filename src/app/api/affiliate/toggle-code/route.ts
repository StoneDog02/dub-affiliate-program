import { NextRequest } from "next/server";
import { z } from "zod";
import { metadataIncludesCode } from "@/lib/affiliate/metadata";
import { findPartnerByToken } from "@/lib/dub/partners";
import { setDiscountActive } from "@/lib/shopify/client";
import { jsonWithCors, optionsResponse } from "@/lib/utils/http";

const toggleSchema = z.object({
  token: z.string().uuid(),
  code: z.string().min(1),
  active: z.boolean(),
});

export async function OPTIONS() {
  return optionsResponse();
}

/**
 * POST /api/affiliate/toggle-code
 *
 * Enables or disables a Shopify discount code for the authenticated affiliate.
 * Body: { token, code, active }
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonWithCors({ error: "Invalid JSON body" }, 400);
  }

  const parsed = toggleSchema.safeParse(body);
  if (!parsed.success) {
    return jsonWithCors({ error: "Invalid request body" }, 400);
  }

  const { token, code, active } = parsed.data;

  const partner = await findPartnerByToken(token);
  if (!partner) {
    return jsonWithCors({ error: "Invalid token" }, 401);
  }

  if (!metadataIncludesCode(partner.metadata, code)) {
    return jsonWithCors({ error: "Code not found for this affiliate" }, 404);
  }

  try {
    await setDiscountActive(code, active);
    return jsonWithCors({ success: true, code, active });
  } catch (error) {
    console.error("[toggle-code]", error);
    return jsonWithCors(
      { error: error instanceof Error ? error.message : "Toggle failed" },
      500,
    );
  }
}
