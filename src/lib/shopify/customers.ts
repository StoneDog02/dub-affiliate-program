import { shopifyGraphql } from "@/lib/shopify/client";

export const AFFILIATE_CUSTOMER_TAG = "affiliate";

export const AFFILIATE_PORTAL_TOKEN_METAFIELD = {
  namespace: "custom",
  key: "affiliate_portal_token",
} as const;

type ShopifyCustomer = {
  id: string;
  tags: string[];
};

export async function findCustomerByEmail(
  email: string,
): Promise<ShopifyCustomer | null> {
  const data = await shopifyGraphql<{
    customers: { nodes: ShopifyCustomer[] };
  }>(
    `query FindCustomer($query: String!) {
      customers(first: 1, query: $query) {
        nodes { id tags }
      }
    }`,
    { query: `email:${email}` },
  );

  return data.customers.nodes[0] ?? null;
}

/** Tag customer as affiliate and store portal token for theme Liquid + nav. */
export async function syncAffiliateShopifyCustomer(
  email: string,
  token: string,
): Promise<{ synced: boolean; reason?: string }> {
  const customer = await findCustomerByEmail(email);
  if (!customer) {
    return { synced: false, reason: "customer_not_found" };
  }

  const tags = [...new Set([...customer.tags, AFFILIATE_CUSTOMER_TAG])];

  const data = await shopifyGraphql<{
    customerUpdate: {
      customer: { id: string } | null;
      userErrors: Array<{ message: string }>;
    };
  }>(
    `mutation SyncAffiliateCustomer($input: CustomerInput!) {
      customerUpdate(input: $input) {
        customer { id }
        userErrors { field message }
      }
    }`,
    {
      input: {
        id: customer.id,
        tags,
        metafields: [
          {
            namespace: AFFILIATE_PORTAL_TOKEN_METAFIELD.namespace,
            key: AFFILIATE_PORTAL_TOKEN_METAFIELD.key,
            type: "single_line_text_field",
            value: token,
          },
        ],
      },
    },
  );

  const errors = data.customerUpdate.userErrors;
  if (errors.length > 0) {
    throw new Error(errors.map((error) => error.message).join(", "));
  }

  return { synced: true };
}
