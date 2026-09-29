import { getDubClient, type DubPartner } from "./client";

export type RecordCareValidateSaleParams = {
  partner: DubPartner;
  saleAmountCents: number;
  invoiceId: string;
  saleEventDate?: string | null;
  customer: {
    externalId: string;
    email?: string | null;
    name?: string | null;
    country?: string;
  };
  affiliateCode: string;
};

async function linkIdForCode(partnerId: string, code: string): Promise<string | undefined> {
  const links = await getDubClient().partners.retrieveLinks({ partnerId });
  const upper = code.trim().toUpperCase();
  return links.find((link) => link.key.toUpperCase() === upper)?.id;
}

/**
 * Record a CareValidate clinical sale in Dub for partner commission + analytics.
 * Uses commissions.create (sale) so attribution works without a prior Dub click.
 * The promo is the partner link key, so the sale is attached to that link.
 */
export async function recordCareValidateSale(
  params: RecordCareValidateSaleParams,
): Promise<{ queued: boolean; message: string }> {
  const dub = getDubClient();
  const partnerId = params.partner.partnerId || params.partner.id;
  const linkId = await linkIdForCode(partnerId, params.affiliateCode);
  if (!linkId) {
    throw new Error(`No Dub link found for affiliate code ${params.affiliateCode}`);
  }

  const result = await dub.commissions.create({
    type: "sale",
    partnerId,
    linkId,
    importStripeInvoices: false,
    saleAmount: params.saleAmountCents,
    invoiceId: params.invoiceId,
    saleEventDate: params.saleEventDate ?? undefined,
    customer: {
      externalId: params.customer.externalId,
      email: params.customer.email ?? undefined,
      name: params.customer.name ?? undefined,
      country: params.customer.country ?? "US",
    },
  });

  return {
    queued: result.success,
    message: result.message,
  };
}

export function isDuplicateCommissionError(error: unknown): boolean {
  const parts: string[] = [];
  if (error instanceof Error) parts.push(error.message);
  if (typeof error === "object" && error) {
    const record = error as { body?: string; error?: { message?: string } };
    if (record.body) parts.push(record.body);
    if (record.error?.message) parts.push(record.error.message);
  }
  return /already a commission|already exists|duplicate/i.test(parts.join(" "));
}
