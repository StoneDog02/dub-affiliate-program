import { NextResponse } from "next/server";
import { isAffiliateCode, parseTierFromCode } from "@/lib/affiliate/tiers";
import { findPartnerByCode, movePartnerToTierGroup } from "@/lib/dub/partners";
import {
  extractDiscountCodes,
  type ShopifyOrderPayload,
} from "@/lib/shopify/client";
import { verifyShopifyWebhook } from "@/lib/utils/http";

/**
 * POST /api/webhooks/shopify-order-complete
 *
 * Fires when a Shopify order is paid/completed.
 * Parses the affiliate discount tier from the code name and moves the partner
 * to the correct Dub commission group BEFORE Dub attributes the sale.
 */
export async function POST(req: Request) {
  const rawBody = await req.text();
  const hmac = req.headers.get("X-Shopify-Hmac-Sha256");

  if (!verifyShopifyWebhook(rawBody, hmac)) {
    return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
  }

  let order: ShopifyOrderPayload;
  try {
    order = JSON.parse(rawBody) as ShopifyOrderPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const discountCodes = extractDiscountCodes(order);
  const affiliateCode = discountCodes.find((code) => isAffiliateCode(code));

  if (!affiliateCode) {
    return NextResponse.json({ ok: true, skipped: true, reason: "no_affiliate_code" });
  }

  const tier = parseTierFromCode(affiliateCode);
  if (!tier) {
    return NextResponse.json({ ok: true, skipped: true, reason: "unknown_tier" });
  }

  try {
    const partner = await findPartnerByCode(affiliateCode);
    if (!partner) {
      return NextResponse.json({ ok: true, skipped: true, reason: "partner_not_found" });
    }

    await movePartnerToTierGroup(partner, tier);

    return NextResponse.json({
      ok: true,
      code: affiliateCode,
      tier,
      partnerId: partner.partnerId ?? partner.id,
    });
  } catch (error) {
    console.error("[shopify-order-complete]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Group move failed" },
      { status: 500 },
    );
  }
}
