function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  shopifyAdminApiKey: () => requireEnv("SHOPIFY_ADMIN_API_KEY"),
  shopifyStoreDomain: () => requireEnv("SHOPIFY_STORE_DOMAIN"),
  shopifyWebhookSecret: () => requireEnv("SHOPIFY_WEBHOOK_SECRET"),
  dubApiKey: () => requireEnv("DUB_API_KEY"),
  dubProgramId: () => requireEnv("DUB_PROGRAM_ID"),
  dubWebhookSecret: () => requireEnv("DUB_WEBHOOK_SECRET"),
  dubGroupIdTierA: () => requireEnv("DUB_GROUP_ID_TIER_A"),
  dubGroupIdTierB: () => requireEnv("DUB_GROUP_ID_TIER_B"),
  dubGroupIdTierC: () => requireEnv("DUB_GROUP_ID_TIER_C"),
  klaviyoApiKey: () => requireEnv("KLAVIYO_API_KEY"),
  portalBaseUrl: () =>
    process.env.NEXT_PUBLIC_PORTAL_BASE_URL ?? "https://bodyiq.com",
  apiBaseUrl: () =>
    process.env.NEXT_PUBLIC_API_BASE_URL ??
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000"),
  dubLinkDomain: () => process.env.DUB_LINK_DOMAIN ?? "bodyiq.dub.link",
  dubPartnerPortalUrl: () =>
    process.env.DUB_PARTNER_PORTAL_URL ?? "https://partners.dub.co",
};
