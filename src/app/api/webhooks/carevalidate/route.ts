import { NextResponse } from "next/server";
import { parseTierFromCode } from "@/lib/affiliate/tiers";
import {
  extractAffiliatePromoCode,
  patientCountry,
  paymentAmountToCents,
} from "@/lib/carevalidate/payload";
import type { CareValidateWebhookPayload } from "@/lib/carevalidate/types";
import { recordCareValidateSale } from "@/lib/dub/commissions";
import { findPartnerByCode, movePartnerToTierGroup } from "@/lib/dub/partners";
import { verifyCareValidateWebhook } from "@/lib/utils/http";

/**
 * POST /api/webhooks/carevalidate
 *
 * CareValidate PAYMENT_COMPLETED → affiliate promo lookup → Dub commission.
 * Promo codes are created manually in CareValidate admin (same strings as Shopify).
 */
export async function POST(req: Request) {
  if (!verifyCareValidateWebhook(req)) {
    return NextResponse.json({ error: "Invalid webhook secret" }, { status: 401 });
  }

  const rawBody = await req.text();
  let body: CareValidateWebhookPayload;
  try {
    body = JSON.parse(rawBody) as CareValidateWebhookPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  if (body.event !== "PAYMENT_COMPLETED") {
    return NextResponse.json({ ok: true, skipped: true, event: body.event });
  }

  const payment = body.payload?.payment;
  if (!payment?.id) {
    return NextResponse.json({ ok: true, skipped: true, reason: "missing_payment" });
  }

  if (payment.status && payment.status !== "PAID") {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "payment_not_paid",
      status: payment.status,
    });
  }

  const affiliateCode = extractAffiliatePromoCode(body);
  if (!affiliateCode) {
    return NextResponse.json({ ok: true, skipped: true, reason: "no_affiliate_code" });
  }

  const tier = parseTierFromCode(affiliateCode);
  if (!tier) {
    return NextResponse.json({ ok: true, skipped: true, reason: "unknown_tier" });
  }

  const saleAmountCents = paymentAmountToCents(payment.amount);
  if (!saleAmountCents) {
    return NextResponse.json({ ok: true, skipped: true, reason: "invalid_amount" });
  }

  const caseData = body.payload?.case;
  const submitter = caseData?.submitter;
  const customerExternalId =
    submitter?.id ?? submitter?.email ?? caseData?.id ?? payment.id;

  try {
    const partner = await findPartnerByCode(affiliateCode);
    if (!partner) {
      return NextResponse.json({ ok: true, skipped: true, reason: "partner_not_found" });
    }

    await movePartnerToTierGroup(partner, tier);

    const commission = await recordCareValidateSale({
      partner,
      saleAmountCents,
      invoiceId: `cv_${payment.id}`,
      saleEventDate: payment.paymentDate,
      affiliateCode,
      customer: {
        externalId: customerExternalId,
        email: submitter?.email,
        name: [submitter?.firstName, submitter?.lastName].filter(Boolean).join(" ") || undefined,
        country: patientCountry(submitter),
      },
    });

    return NextResponse.json({
      ok: true,
      code: affiliateCode,
      tier,
      partnerId: partner.partnerId ?? partner.id,
      paymentId: payment.id,
      saleAmountCents,
      commission,
    });
  } catch (error) {
    console.error("[carevalidate-payment]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Commission recording failed" },
      { status: 500 },
    );
  }
}
