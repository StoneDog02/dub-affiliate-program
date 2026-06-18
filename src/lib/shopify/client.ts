import { env } from "@/lib/env";

const API_VERSION = "2025-01";

type GraphQLResponse<T> = {
  data?: T;
  errors?: Array<{ message: string }>;
};

async function shopifyGraphql<T>(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const domain = env.shopifyStoreDomain().replace(/^https?:\/\//, "");
  const response = await fetch(
    `https://${domain}/admin/api/${API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": env.shopifyAdminApiKey(),
      },
      body: JSON.stringify({ query, variables }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Shopify GraphQL failed (${response.status}): ${text}`);
  }

  const json = (await response.json()) as GraphQLResponse<T>;
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join(", "));
  }

  if (!json.data) {
    throw new Error("Shopify GraphQL returned no data");
  }

  return json.data;
}

type DiscountNode = {
  id: string;
  codeDiscount: {
    title: string;
    status: string;
    codes: { nodes: Array<{ code: string }> };
  };
};

/** Create a percentage-off discount code — lifetime, unlimited uses, active. */
export async function createDiscountCode(
  code: string,
  percentage: number,
): Promise<void> {
  const data = await shopifyGraphql<{
    discountCodeBasicCreate: {
      codeDiscountNode: { id: string } | null;
      userErrors: Array<{ message: string }>;
    };
  }>(
    `mutation CreateAffiliateCode($input: DiscountCodeBasicInput!) {
      discountCodeBasicCreate(basicCodeDiscount: $input) {
        codeDiscountNode { id }
        userErrors { field message }
      }
    }`,
    {
      input: {
        title: `Affiliate ${code}`,
        code,
        startsAt: new Date().toISOString(),
        customerGets: {
          value: { percentage: percentage / 100 },
          items: { all: true },
        },
        context: { all: true },
        usageLimit: null,
        appliesOncePerCustomer: false,
      },
    },
  );

  const errors = data.discountCodeBasicCreate.userErrors;
  if (errors.length > 0) {
    throw new Error(errors.map((e) => e.message).join(", "));
  }
}

export async function getDiscountByCode(code: string): Promise<DiscountNode | null> {
  const data = await shopifyGraphql<{
    codeDiscountNodeByCode: DiscountNode | null;
  }>(
    `query GetCode($code: String!) {
      codeDiscountNodeByCode(code: $code) {
        id
        codeDiscount {
          ... on DiscountCodeBasic {
            title
            status
            codes(first: 1) { nodes { code } }
          }
        }
      }
    }`,
    { code },
  );

  return data.codeDiscountNodeByCode;
}

export async function isDiscountActive(code: string): Promise<boolean> {
  const node = await getDiscountByCode(code);
  if (!node) return false;
  return node.codeDiscount.status === "ACTIVE";
}

export async function setDiscountActive(
  code: string,
  active: boolean,
): Promise<void> {
  const node = await getDiscountByCode(code);
  if (!node) {
    throw new Error(`Discount code not found: ${code}`);
  }

  const mutation = active ? "discountCodeActivate" : "discountCodeDeactivate";
  const data = await shopifyGraphql<{
    discountCodeActivate?: { userErrors: Array<{ message: string }> };
    discountCodeDeactivate?: { userErrors: Array<{ message: string }> };
  }>(
    `mutation ToggleCode($id: ID!) {
      ${mutation}(id: $id) {
        userErrors { field message }
      }
    }`,
    { id: node.id },
  );

  const result = data.discountCodeActivate ?? data.discountCodeDeactivate;
  const errors = result?.userErrors ?? [];
  if (errors.length > 0) {
    throw new Error(errors.map((e) => e.message).join(", "));
  }
}

export type ShopifyOrderPayload = {
  discount_codes?: Array<{ code: string; amount?: string; type?: string }>;
  discount_applications?: Array<{ code?: string; title?: string; type?: string }>;
};

export function extractDiscountCodes(order: ShopifyOrderPayload): string[] {
  const codes = new Set<string>();

  for (const entry of order.discount_codes ?? []) {
    if (entry.code) codes.add(entry.code);
  }

  for (const app of order.discount_applications ?? []) {
    if (app.code) codes.add(app.code);
  }

  return [...codes];
}
