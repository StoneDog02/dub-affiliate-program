import { NextRequest } from "next/server";
import { z } from "zod";
import { changeCodeAvailability } from "@/lib/affiliate/code-availability";
import { metadataIncludesCode } from "@/lib/affiliate/metadata";
import { getDubClient } from "@/lib/dub/client";
import { affiliateLinkForCode } from "@/lib/dub/partner-links";
import { findPartnerByToken } from "@/lib/dub/partners";
import { getDiscountByCode, isDiscountActive, setDiscountActive } from "@/lib/shopify/client";
import { jsonWithCors, optionsResponse } from "@/lib/utils/http";

const toggleSchema = z.object({
  token: z.string().uuid(),
  code: z.string().min(1),
  active: z.boolean(),
});

export async function OPTIONS(req: NextRequest) {
  return optionsResponse(req);
}

/**
 * POST /api/affiliate/toggle-code
 *
 * Enables or disables both a Shopify discount code and its Dub tracking link.
 * CareValidate promos must be toggled manually in CV admin.
 * Body: { token, code, active }
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonWithCors({ error: "Invalid JSON body" }, 400, req);
  }

  const parsed = toggleSchema.safeParse(body);
  if (!parsed.success) {
    return jsonWithCors({ error: "Invalid request body" }, 400, req);
  }

  const { token, code, active } = parsed.data;

  const partner = await findPartnerByToken(token);
  if (!partner) {
    return jsonWithCors({ error: "Invalid token" }, 401, req);
  }

  if (!metadataIncludesCode(partner.metadata, code)) {
    return jsonWithCors({ error: "Code not found for this affiliate" }, 404, req);
  }

  try {
    const [discount, link] = await Promise.all([
      getDiscountByCode(code),
      affiliateLinkForCode(partner, code),
    ]);
    if (!discount) {
      return jsonWithCors({ error: "Shopify discount code not found" }, 404, req);
    }

    await changeCodeAvailability({
      active,
      discountActive: discount.codeDiscount.status === "ACTIVE",
      linkExpiresAt: link.expiresAt,
      setDiscountActive: async (value) => {
        await setDiscountActive(code, value);
        if ((await isDiscountActive(code)) !== value) {
          throw new Error("Shopify did not confirm the discount status change");
        }
      },
      setLinkExpiresAt: async (expiresAt) => {
        const updated = await getDubClient().links.update(link.id, { expiresAt });
        if (updated.expiresAt !== expiresAt) {
          throw new Error("Dub did not confirm the tracking link status change");
        }
      },
    });
    return jsonWithCors({ success: true, code, active }, 200, req);
  } catch (error) {
    console.error("[toggle-code]", error);
    return jsonWithCors(
      { error: error instanceof Error ? error.message : "Toggle failed" },
      500,
      req,
    );
  }
}
