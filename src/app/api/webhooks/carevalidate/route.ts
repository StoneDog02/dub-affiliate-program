import { NextResponse } from "next/server";
import {
  extractAffiliatePromoCode,
  patientCountry,
  paymentAmountToCents,
} from "@/lib/carevalidate/payload";
import type { CareValidateWebhookPayload } from "@/lib/carevalidate/types";
import { correctCommissionsForInvoice } from "@/lib/dub/commission-corrections";
import {
  isDuplicateCommissionError,
  recordCareValidateSale,
} from "@/lib/dub/commissions";
import { findPartnerByCode } from "@/lib/dub/partners";
import { verifyCareValidateWebhook } from "@/lib/utils/http";

/**
 * POST /api/webhooks/carevalidate
 *
 * CareValidate PAYMENT_COMPLETED → affiliate promo lookup → Dub commission.
 * The sale is tied to that promo's link, then earnings are set from the code.
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

  const saleAmountCents = paymentAmountToCents(payment.amount);
  if (!saleAmountCents) {
    return NextResponse.json({ ok: true, skipped: true, reason: "invalid_amount" });
  }

  const caseData = body.payload?.case;
  const submitter = caseData?.submitter;
  const customerExternalId =
    submitter?.id ?? submitter?.email ?? caseData?.id ?? payment.id;
  const invoiceId = `cv_${payment.id}`;

  try {
    const partner = await findPartnerByCode(affiliateCode);
    if (!partner) {
      return NextResponse.json({ ok: true, skipped: true, reason: "partner_not_found" });
    }

    try {
      await recordCareValidateSale({
        partner,
        saleAmountCents,
        invoiceId,
        saleEventDate: payment.paymentDate,
        affiliateCode,
        customer: {
          externalId: customerExternalId,
          email: submitter?.email,
          name: [submitter?.firstName, submitter?.lastName].filter(Boolean).join(" ") || undefined,
          country: patientCountry(submitter),
        },
      });
    } catch (error) {
      if (!isDuplicateCommissionError(error)) throw error;
    }

    const correction = await correctCommissionsForInvoice({
      invoiceId,
      orderCodes: [affiliateCode],
      wait: true,
    });

    if (correction.action === "pending") {
      return NextResponse.json({ error: "Commission not ready" }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      code: affiliateCode,
      partnerId: partner.partnerId ?? partner.id,
      paymentId: payment.id,
      saleAmountCents,
      correction,
    });
  } catch (error) {
    console.error("[carevalidate-payment]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Commission recording failed" },
      { status: 500 },
    );
  }
}
