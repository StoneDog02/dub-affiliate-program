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

/**
 * Record a CareValidate clinical sale in Dub for partner commission + analytics.
 * Uses commissions.create (sale) so attribution works without a prior Dub click.
 */
export async function recordCareValidateSale(
  params: RecordCareValidateSaleParams,
): Promise<{ queued: boolean; message: string }> {
  const dub = getDubClient();
  const partnerId = params.partner.partnerId || params.partner.id;

  const result = await dub.commissions.create({
    type: "sale",
    partnerId,
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
