import { NextResponse } from "next/server";
import { correctCommissionsForInvoice } from "@/lib/dub/commission-corrections";
import {
  extractDiscountCodes,
  type ShopifyOrderPayload,
} from "@/lib/shopify/client";
import { verifyShopifyWebhook } from "@/lib/utils/http";

/**
 * POST /api/webhooks/shopify-order-complete
 *
 * Fires when a Shopify order is paid. Sets the Dub sale earnings from the
 * affiliate code when it belongs to the partner Dub paid, otherwise from
 * that commission's link key. Dub creates the sale on a queue, so a missing
 * commission is left for the reconcile cron.
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

  const confirmationNumber = order.confirmation_number?.trim();
  if (!confirmationNumber) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "no_confirmation_number",
    });
  }

  try {
    const correction = await correctCommissionsForInvoice({
      invoiceId: confirmationNumber,
      orderCodes: extractDiscountCodes(order),
    });

    return NextResponse.json({
      ok: true,
      confirmationNumber,
      correction,
    });
  } catch (error) {
    console.error("[shopify-order-complete]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Commission correction failed" },
      { status: 500 },
    );
  }
}
