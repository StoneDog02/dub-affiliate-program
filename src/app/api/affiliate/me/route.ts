import { NextRequest } from "next/server";
import { metadataIncludesCode } from "@/lib/affiliate/metadata";
import { findPartnerByToken } from "@/lib/dub/partners";
import { env } from "@/lib/env";
import { isDiscountActive } from "@/lib/shopify/client";
import { TIER_CONFIG } from "@/lib/affiliate/tiers";
import type { AffiliateMeResponse } from "@/lib/affiliate/types";
import { jsonWithCors, optionsResponse } from "@/lib/utils/http";

export async function OPTIONS(req: NextRequest) {
  return optionsResponse(req);
}

/**
 * GET /api/affiliate/me?token=[TOKEN]
 *
 * Returns affiliate profile, Dub portal link, and live Shopify active/inactive
 * status for each tier discount code.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");

  if (!token) {
    return jsonWithCors({ error: "Missing token" }, 401, req);
  }

  const partner = await findPartnerByToken(token);
  if (!partner) {
    return jsonWithCors({ error: "Invalid token" }, 401, req);
  }

  const { metadata } = partner;
  const tiers = await Promise.all(
    (["10", "15", "20"] as const).map(async (tier) => {
      const code = metadata[`code_${tier}`];
      const link = metadata[`link_${tier}`];
      const active = await isDiscountActive(code);

      return {
        code,
        link,
        discount: TIER_CONFIG[tier].discount,
        commission: TIER_CONFIG[tier].commission,
        active,
      };
    }),
  );

  const response: AffiliateMeResponse = {
    name: partner.name,
    email: partner.email ?? "",
    dub_portal_url: env.dubPartnerPortalUrl(),
    tiers,
  };

  return jsonWithCors(response, 200, req);
}
