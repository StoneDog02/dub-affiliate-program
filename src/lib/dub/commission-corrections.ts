import type { AffiliateMetadata, TierKey } from "@/lib/affiliate/types";
import { commissionRateForSale } from "@/lib/affiliate/commission-rates";
import { parseTierFromCode, TIER_CONFIG } from "@/lib/affiliate/tiers";
import { getOrderDiscountCodesByConfirmation } from "@/lib/shopify/client";
import { dubFetch, getDubClient } from "./client";
import { listAllPartners, resolvePartnerMetadata } from "./partners";

const PATCHABLE_STATUSES = new Set(["pending", "processed"]);
const PAGE_SIZE = 100;
const MAX_PAGES = 50;
const WAIT_DELAYS_MS = [0, 400, 800, 1200, 2000, 3000];

export type SaleCommission = {
  id: string;
  type?: string;
  amount: number;
  earnings: number;
  currency: string;
  status: string;
  invoiceId: string | null;
  createdAt?: string;
  partner: { id: string; name?: string; email?: string | null };
  link?: { key?: string | null } | null;
  customer?: { id?: string } | null;
};

export type CommissionTierDecision = {
  tier: TierKey;
  source: "code" | "link";
  key: string;
};

export type CorrectionAction =
  | "patched"
  | "unchanged"
  | "paid_mismatch"
  | "unpriced"
  | "skipped"
  | "pending";

export type CorrectionRow = {
  action: CorrectionAction;
  invoiceId: string;
  commissionId?: string;
  partnerId?: string;
  partnerName?: string;
  partnerEmail?: string | null;
  status?: string;
  tier?: TierKey;
  source?: "code" | "link";
  key?: string;
  amount?: number;
  earnings?: number;
  targetEarnings?: number;
  reason?: string;
};

function tierForOwnedCode(
  metadata: AffiliateMetadata,
  code: string,
): TierKey | null {
  const upper = code.trim().toUpperCase();
  if (!upper) return null;
  if (metadata.code_10.trim().toUpperCase() === upper) return "10";
  if (metadata.code_15.trim().toUpperCase() === upper) return "15";
  if (metadata.code_20.trim().toUpperCase() === upper) return "20";
  return null;
}

/**
 * Price from an order code only when it belongs to this partner.
 * Otherwise use the commission link key (SH10, SH15, or SH20).
 */
export function decideCommissionTier(input: {
  metadata: AffiliateMetadata | null;
  orderCodes: string[];
  linkKey?: string | null;
}): CommissionTierDecision | null {
  if (input.metadata) {
    for (const code of input.orderCodes) {
      const tier = tierForOwnedCode(input.metadata, code);
      if (tier) return { tier, source: "code", key: code };
    }
  }

  const linkKey = input.linkKey?.trim();
  if (linkKey) {
    const tier = parseTierFromCode(linkKey);
    if (tier) return { tier, source: "link", key: linkKey };
  }

  return null;
}

export function targetEarningsCents(
  amountCents: number,
  tier: TierKey,
  saleCreatedAt?: string,
): number {
  const commission = commissionRateForSale(
    tier,
    saleCreatedAt,
    TIER_CONFIG[tier].commission,
  );
  return Math.round((amountCents * commission) / 100);
}

function asCommissionList(
  payload: SaleCommission[] | { result?: SaleCommission[] },
): SaleCommission[] {
  return Array.isArray(payload) ? payload : (payload.result ?? []);
}

export async function listSaleCommissions(params: {
  start?: string;
  invoiceId?: string;
}): Promise<SaleCommission[]> {
  const all: SaleCommission[] = [];
  let startingAfter: string | undefined;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const search = new URLSearchParams({
      type: "sale",
      pageSize: String(PAGE_SIZE),
    });
    if (params.start) search.set("start", params.start);
    if (params.invoiceId) search.set("invoiceId", params.invoiceId);
    if (startingAfter) search.set("startingAfter", startingAfter);

    const batch = asCommissionList(
      await dubFetch<SaleCommission[] | { result?: SaleCommission[] }>(
        `/commissions?${search.toString()}`,
      ),
    );
    all.push(...batch);

    if (params.invoiceId || batch.length < PAGE_SIZE) break;
    const next = batch[batch.length - 1]?.id;
    if (!next || next === startingAfter) break;
    startingAfter = next;
  }

  return all.filter((row) => !row.type || row.type === "sale");
}

async function customerLinkKey(customerId: string): Promise<string | null> {
  try {
    const customer = await dubFetch<{ link?: { key?: string | null } | null }>(
      `/customers/${encodeURIComponent(customerId)}?includeExpandedFields=true`,
    );
    return customer.link?.key?.trim() || null;
  } catch {
    return null;
  }
}

/** Link key Dub stored on the commission, or the customer's attribution link. */
export async function resolveCommissionLinkKey(
  commission: SaleCommission,
  cache?: Map<string, string | null>,
): Promise<string | null> {
  const direct = commission.link?.key?.trim();
  if (direct) return direct;

  const customerId = commission.customer?.id;
  if (!customerId) return null;
  if (cache?.has(customerId)) return cache.get(customerId) ?? null;

  const key = await customerLinkKey(customerId);
  cache?.set(customerId, key);
  return key;
}

function metadataByPartnerId(
  partners: Awaited<ReturnType<typeof listAllPartners>>,
): Map<string, AffiliateMetadata | null> {
  const byId = new Map<string, AffiliateMetadata | null>();
  for (const partner of partners) {
    const metadata = resolvePartnerMetadata(partner);
    if (partner.id) byId.set(partner.id, metadata);
    if (partner.partnerId) byId.set(partner.partnerId, metadata);
  }
  return byId;
}

export async function correctSaleCommission(input: {
  commission: SaleCommission;
  orderCodes: string[];
  metadata: AffiliateMetadata | null;
  linkCache?: Map<string, string | null>;
}): Promise<CorrectionRow> {
  const { commission } = input;
  const base: CorrectionRow = {
    action: "skipped",
    invoiceId: commission.invoiceId ?? "",
    commissionId: commission.id,
    partnerId: commission.partner.id,
    partnerName: commission.partner.name,
    partnerEmail: commission.partner.email,
    status: commission.status,
    amount: commission.amount,
    earnings: commission.earnings,
  };

  if (commission.type && commission.type !== "sale") {
    return { ...base, reason: commission.type };
  }

  const linkKey = await resolveCommissionLinkKey(commission, input.linkCache);
  const decision = decideCommissionTier({
    metadata: input.metadata,
    orderCodes: input.orderCodes,
    linkKey,
  });
  if (!decision) {
    return { ...base, action: "unpriced" };
  }

  const targetEarnings = targetEarningsCents(
    commission.amount,
    decision.tier,
    commission.createdAt,
  );
  const decided: CorrectionRow = {
    ...base,
    tier: decision.tier,
    source: decision.source,
    key: decision.key,
    targetEarnings,
  };

  if (commission.earnings === targetEarnings) {
    return { ...decided, action: "unchanged" };
  }

  if (commission.status === "paid") {
    return { ...decided, action: "paid_mismatch" };
  }

  if (!PATCHABLE_STATUSES.has(commission.status)) {
    return { ...decided, action: "skipped", reason: commission.status };
  }

  await getDubClient().commissions.update({
    id: commission.id,
    requestBody: { earnings: targetEarnings },
  });

  return { ...decided, action: "patched", earnings: targetEarnings };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function correctCommissionsForInvoice(input: {
  invoiceId: string;
  orderCodes: string[];
  metadata?: AffiliateMetadata | null;
  wait?: boolean;
}): Promise<CorrectionRow> {
  const delays = input.wait ? WAIT_DELAYS_MS : [0];

  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    const delay = delays[attempt] ?? 0;
    if (delay > 0) await sleep(delay);

    const commissions = await listSaleCommissions({ invoiceId: input.invoiceId });
    const sale = commissions.find((row) => !row.type || row.type === "sale");
    if (!sale) continue;

    let metadata = input.metadata;
    if (metadata === undefined) {
      const partners = metadataByPartnerId(await listAllPartners());
      metadata = partners.get(sale.partner.id) ?? null;
    }

    return correctSaleCommission({
      commission: sale,
      orderCodes: input.orderCodes,
      metadata,
    });
  }

  return { action: "pending", invoiceId: input.invoiceId };
}

async function orderCodesForInvoice(
  invoiceId: string,
  cache: Map<string, string[]>,
): Promise<string[]> {
  const cached = cache.get(invoiceId);
  if (cached) return cached;

  if (invoiceId.startsWith("cv_")) {
    cache.set(invoiceId, []);
    return [];
  }

  const codes = (await getOrderDiscountCodesByConfirmation(invoiceId)) ?? [];
  cache.set(invoiceId, codes);
  return codes;
}

export async function reconcileSalesSince(since: Date): Promise<CorrectionRow[]> {
  const partners = metadataByPartnerId(await listAllPartners());
  const commissions = await listSaleCommissions({ start: since.toISOString() });
  const sinceMs = since.getTime();
  const linkCache = new Map<string, string | null>();
  const orderCache = new Map<string, string[]>();
  const rows: CorrectionRow[] = [];

  for (const commission of commissions) {
    if (commission.createdAt && Date.parse(commission.createdAt) < sinceMs) {
      continue;
    }

    const invoiceId = commission.invoiceId ?? "";
    const orderCodes = invoiceId
      ? await orderCodesForInvoice(invoiceId, orderCache)
      : [];
    const metadata = partners.get(commission.partner.id) ?? null;
    rows.push(
      await correctSaleCommission({
        commission,
        orderCodes,
        metadata,
        linkCache,
      }),
    );
  }

  return rows;
}

export function summarizeCorrections(rows: CorrectionRow[]): Record<CorrectionAction, number> {
  const summary: Record<CorrectionAction, number> = {
    patched: 0,
    unchanged: 0,
    paid_mismatch: 0,
    unpriced: 0,
    skipped: 0,
    pending: 0,
  };
  for (const row of rows) {
    summary[row.action] += 1;
  }
  return summary;
}
