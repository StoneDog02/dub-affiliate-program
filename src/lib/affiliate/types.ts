export type AffiliateMetadata = {
  token: string;
  code_10: string;
  link_10: string;
  code_15: string;
  link_15: string;
  code_20: string;
  link_20: string;
};

export type TierKey = "10" | "15" | "20";

export type TierConfig = {
  discount: number;
  commission: number;
  dubGroupId: () => string;
};

export type AffiliateTier = {
  code: string;
  link: string;
  discount: number;
  commission: number;
  active: boolean;
};

export type AffiliateMeResponse = {
  name: string;
  email: string;
  dub_portal_url: string;
  tiers: AffiliateTier[];
};
