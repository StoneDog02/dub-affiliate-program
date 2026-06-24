import { isAffiliateCode } from "@/lib/affiliate/tiers";
import type { CareValidateWebhookPayload } from "./types";

function normalizeCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function codesFromPromoCodesField(value: unknown): string[] {
  if (!value) return [];

  if (typeof value === "string") {
    const code = normalizeCode(value);
    return code ? [code] : [];
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => normalizeCode(entry))
      .filter((entry): entry is string => Boolean(entry));
  }

  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>)
      .map((entry) => normalizeCode(entry))
      .filter((entry): entry is string => Boolean(entry));
  }

  return [];
}

/**
 * Extract a promo / referral code from a CareValidate webhook payload.
 * Public docs only guarantee `case.referralCode`; we also scan common alternates.
 */
export function extractAffiliatePromoCode(
  body: CareValidateWebhookPayload,
): string | null {
  const payload = body.payload;
  const caseData = payload?.case;

  const candidates = [
    caseData?.referralCode,
    caseData?.promoCode,
    payload?.promoCode,
    ...codesFromPromoCodesField(caseData?.promoCodes),
    ...codesFromPromoCodesField(payload?.promoCodes),
  ];

  for (const candidate of candidates) {
    const code = normalizeCode(candidate);
    if (code && isAffiliateCode(code)) {
      return code;
    }
  }

  return null;
}

/** Payment amount in Dub cents (CareValidate sends dollar amounts as strings). */
export function paymentAmountToCents(amount: string | number | undefined): number | null {
  if (amount === undefined || amount === null || amount === "") {
    return null;
  }

  const dollars = typeof amount === "number" ? amount : Number.parseFloat(amount);
  if (!Number.isFinite(dollars) || dollars <= 0) {
    return null;
  }

  return Math.round(dollars * 100);
}

export function patientCountry(submitter?: { state?: string }): string {
  const state = submitter?.state?.trim();
  if (state && state.length === 2) {
    return "US";
  }
  return "US";
}
