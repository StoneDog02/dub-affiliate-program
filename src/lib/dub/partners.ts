import {
  metadataIncludesCode,
  parseMetadataFromDescription,
  reconstructMetadataFromLinks,
  serializeMetadata,
} from "@/lib/affiliate/metadata";
import type { AffiliateMetadata } from "@/lib/affiliate/types";
import { homeGroupId } from "@/lib/affiliate/tiers";
import { getDubClient, type DubPartner } from "./client";

/** Paginate through all program partners (low volume — acceptable for portal lookups). */
export async function listAllPartners(): Promise<DubPartner[]> {
  const dub = getDubClient();
  const partners: DubPartner[] = [];
  let page = 1;

  while (true) {
    const batch = (await dub.partners.list({
      page,
      pageSize: 100,
      status: "approved",
    })) as DubPartner[];

    if (batch.length === 0) break;
    partners.push(...batch);
    if (batch.length < 100) break;
    page += 1;
  }

  return partners;
}

export function getPartnerMetadata(partner: DubPartner): AffiliateMetadata | null {
  return parseMetadataFromDescription(partner.description);
}

export function resolvePartnerMetadata(partner: DubPartner): AffiliateMetadata | null {
  const parsed = getPartnerMetadata(partner);
  if (parsed) return parsed;

  if (partner.tenantId) {
    return reconstructMetadataFromLinks(partner.tenantId, partner.links);
  }

  return null;
}

export function isPartnerProvisioned(partner: DubPartner): boolean {
  return resolvePartnerMetadata(partner) !== null;
}

export async function findPartnerByToken(
  token: string,
): Promise<(DubPartner & { metadata: AffiliateMetadata }) | null> {
  const dub = getDubClient();

  // Fast path: tenantId is set to the portal token during onboarding.
  const byTenant = (await dub.partners.list({ tenantId: token })) as DubPartner[];
  for (const partner of byTenant) {
    const metadata = resolvePartnerMetadata(partner);
    if (metadata?.token === token) {
      return { ...partner, metadata };
    }
  }

  // Fallback: scan partner metadata (handles legacy records).
  for (const partner of await listAllPartners()) {
    const metadata = resolvePartnerMetadata(partner);
    if (metadata?.token === token) {
      return { ...partner, metadata };
    }
  }

  return null;
}

export async function findPartnerByCode(
  code: string,
): Promise<(DubPartner & { metadata: AffiliateMetadata }) | null> {
  for (const partner of await listAllPartners()) {
    const metadata = resolvePartnerMetadata(partner);
    if (metadata && metadataIncludesCode(metadata, code)) {
      return { ...partner, metadata };
    }
  }
  return null;
}

export async function findPartnerByEmail(
  email: string,
): Promise<(DubPartner & { metadata: AffiliateMetadata }) | null> {
  const normalized = email.trim().toLowerCase();

  for (const partner of await listAllPartners()) {
    if (partner.email?.trim().toLowerCase() !== normalized) continue;

    const metadata = resolvePartnerMetadata(partner);
    if (metadata?.token) {
      return { ...partner, metadata };
    }
  }

  return null;
}

/** Persist affiliate metadata on the Dub partner record via description + tenantId. */
export async function updatePartnerMetadata(
  partner: Pick<DubPartner, "email" | "name">,
  metadata: AffiliateMetadata,
): Promise<void> {
  const dub = getDubClient();
  await dub.partners.create({
    email: partner.email!,
    name: partner.name,
    tenantId: metadata.token,
    groupId: homeGroupId(),
    description: serializeMetadata(metadata),
  });
}

export async function createPartnerLink(
  partnerId: string,
  code: string,
  destinationUrl: string,
): Promise<string> {
  const dub = getDubClient();
  const link = await dub.partners.createLink({
    partnerId,
    url: destinationUrl,
    key: code,
  });

  return link.shortLink;
}

/**
 * Put a partner in the single 20% home group.
 * Uses partner upsert with groupId. Does not rewrite commissions already recorded.
 */
export async function movePartnerToHomeGroup(partner: DubPartner): Promise<boolean> {
  const groupId = homeGroupId();
  if (partner.groupId === groupId) {
    return false;
  }

  const dub = getDubClient();
  await dub.partners.create({
    email: partner.email!,
    name: partner.name,
    tenantId: partner.tenantId ?? undefined,
    groupId,
    description: partner.description ?? undefined,
  });
  return true;
}

export async function moveAllPartnersToHomeGroup(): Promise<{
  moved: number;
  unchanged: number;
}> {
  let moved = 0;
  let unchanged = 0;

  for (const partner of await listAllPartners()) {
    if (await movePartnerToHomeGroup(partner)) {
      moved += 1;
    } else {
      unchanged += 1;
    }
  }

  return { moved, unchanged };
}

export async function getPartnerById(partnerId: string): Promise<DubPartner | null> {
  const partners = await listAllPartners();
  return partners.find((p) => p.partnerId === partnerId || p.id === partnerId) ?? null;
}
