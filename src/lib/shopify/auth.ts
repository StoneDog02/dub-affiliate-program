import { env } from "@/lib/env";

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

function shopifyShopDomain(): string {
  return env.shopifyStoreDomain().replace(/^https?:\/\//, "");
}

/** Dev Dashboard apps use client credentials; legacy custom apps may use a static token. */
export async function getShopifyAccessToken(): Promise<string> {
  const staticToken = process.env.SHOPIFY_ADMIN_API_KEY;
  if (staticToken && !process.env.SHOPIFY_CLIENT_ID) {
    return staticToken;
  }

  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) {
    return cachedToken;
  }

  const response = await fetch(
    `https://${shopifyShopDomain()}/admin/oauth/access_token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: env.shopifyClientId(),
        client_secret: env.shopifyClientSecret(),
      }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Shopify token request failed (${response.status}): ${text}`);
  }

  const json = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };

  cachedToken = json.access_token;
  tokenExpiresAt = Date.now() + json.expires_in * 1000;
  return cachedToken;
}
