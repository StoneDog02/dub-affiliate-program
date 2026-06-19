import { NextResponse } from "next/server";
import { findPartnerByEmail } from "@/lib/dub/partners";
import { syncAffiliateShopifyCustomer } from "@/lib/shopify/customers";
import { verifyShopifyWebhook } from "@/lib/utils/http";

type ShopifyCustomerPayload = {
  email?: string | null;
};

/**
 * POST /api/webhooks/shopify-customer-created
 *
 * When a new Shopify customer registers, link them to an existing Dub affiliate
 * account (same email) so the portal nav + login gate work.
 */
export async function POST(req: Request) {
  const rawBody = await req.text();
  const hmac = req.headers.get("X-Shopify-Hmac-Sha256");

  if (!verifyShopifyWebhook(rawBody, hmac)) {
    return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
  }

  let customer: ShopifyCustomerPayload;
  try {
    customer = JSON.parse(rawBody) as ShopifyCustomerPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const email = customer.email?.trim();
  if (!email) {
    return NextResponse.json({ ok: true, skipped: true, reason: "no_email" });
  }

  try {
    const partner = await findPartnerByEmail(email);
    if (!partner) {
      return NextResponse.json({ ok: true, skipped: true, reason: "not_affiliate" });
    }

    const result = await syncAffiliateShopifyCustomer(email, partner.metadata.token);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[shopify-customer-created]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Customer sync failed" },
      { status: 500 },
    );
  }
}
