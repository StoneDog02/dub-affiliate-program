/**
 * Read-only audit of Dub commissions for internal UGC checkouts.
 *
 * Matches Shopify orders that used INTERNAL_DISCOUNT_CODES (default BTadmin99)
 * or whose billing name is Brandon Taylor. Looks up Dub commissions by
 * Shopify confirmation number. Does not cancel, patch, or delete anything.
 *
 * Usage:
 *   node --experimental-strip-types --env-file=.env.local scripts/audit-internal-commissions.ts
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";

const SHOPIFY_API_VERSION = "2025-01";
const BILLING_NAME = "brandon taylor";
const PAGE_SIZE = 50;
const MAX_PAGES = 40;

type ShopifyOrder = {
  id: string;
  name: string;
  createdAt: string;
  confirmationNumber: string | null;
  email: string | null;
  tags: string[];
  discountCodes: string[];
  customAttributes: Array<{ key: string; value: string | null }>;
  billingAddress: {
    name: string | null;
    firstName: string | null;
    lastName: string | null;
  } | null;
  customer: { email: string | null; displayName: string | null } | null;
  currentSubtotalPriceSet: {
    shopMoney: { amount: string; currencyCode: string };
  } | null;
};

type DubPartner = {
  id: string;
  name: string;
  email: string | null;
};

type DubCommission = {
  id: string;
  type?: string;
  amount: number;
  earnings: number;
  currency: string;
  status: string;
  invoiceId: string | null;
  partner: DubPartner;
  customer?: { id: string; email?: string | null } | null;
};

type DubCustomer = {
  id: string;
  link?: { key?: string | null; shortLink?: string | null } | null;
};

type MatchedOrder = {
  order: ShopifyOrder;
  reasons: Set<string>;
};

type AuditRow = {
  order: string;
  email: string;
  discounts: string;
  dubClickId: string;
  partner: string;
  partnerEmail: string;
  linkKey: string;
  saleAmount: string;
  earnings: string;
  status: string;
  commissionType: string;
  match: string;
  invoiceId: string;
  subtotal: string;
};

function loadLocalEnv(): void {
  for (const name of [".env.local", ".env"]) {
    const path = resolve(process.cwd(), name);
    if (existsSync(path)) {
      process.loadEnvFile(path);
    }
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseList(value: string | undefined, fallback: string): string[] {
  const source = value?.trim() ? value : fallback;
  return [
    ...new Set(
      source
        .split(",")
        .map((entry) => entry.trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
}

function shopDomain(): string {
  return requireEnv("SHOPIFY_STORE_DOMAIN").replace(/^https?:\/\//, "");
}

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

async function shopifyAccessToken(): Promise<string> {
  const staticToken = process.env.SHOPIFY_ADMIN_API_KEY;
  if (staticToken && !process.env.SHOPIFY_CLIENT_ID) {
    return staticToken;
  }

  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) {
    return cachedToken;
  }

  const response = await fetch(
    `https://${shopDomain()}/admin/oauth/access_token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: requireEnv("SHOPIFY_CLIENT_ID"),
        client_secret: requireEnv("SHOPIFY_CLIENT_SECRET"),
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

async function shopifyGraphql<T>(
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(
    `https://${shopDomain()}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": await shopifyAccessToken(),
      },
      body: JSON.stringify({ query, variables }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Shopify GraphQL failed (${response.status}): ${text}`);
  }

  const json = (await response.json()) as {
    data?: T;
    errors?: Array<{ message: string }>;
  };
  if (json.errors?.length) {
    throw new Error(json.errors.map((error) => error.message).join(", "));
  }
  if (!json.data) {
    throw new Error("Shopify GraphQL returned no data");
  }
  return json.data;
}

const ORDERS_QUERY = `
  query AuditOrders($cursor: String, $query: String!) {
    orders(first: ${PAGE_SIZE}, after: $cursor, query: $query, sortKey: CREATED_AT, reverse: true) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        name
        createdAt
        confirmationNumber
        email
        tags
        discountCodes
        customAttributes { key value }
        billingAddress { name firstName lastName }
        customer { email displayName }
        currentSubtotalPriceSet { shopMoney { amount currencyCode } }
      }
    }
  }
`;

async function* paginateOrders(search: string): AsyncGenerator<ShopifyOrder> {
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const data: {
      orders: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: ShopifyOrder[];
      };
    } = await shopifyGraphql(ORDERS_QUERY, { cursor, query: search });

    for (const order of data.orders.nodes) {
      yield order;
    }

    if (!data.orders.pageInfo.hasNextPage || !data.orders.pageInfo.endCursor) {
      return;
    }
    cursor = data.orders.pageInfo.endCursor;
  }

  console.error(
    `Stopped after ${MAX_PAGES} pages for Shopify search: ${search}`,
  );
}

function billingName(order: ShopifyOrder): string {
  const address = order.billingAddress;
  if (!address) return "";
  if (address.name?.trim()) return address.name.trim();
  return [address.firstName, address.lastName].filter(Boolean).join(" ").trim();
}

function isBrandonTaylorBilling(order: ShopifyOrder): boolean {
  return billingName(order).replace(/\s+/g, " ").toLowerCase() === BILLING_NAME;
}

function orderEmail(order: ShopifyOrder): string {
  return order.email?.trim() || order.customer?.email?.trim() || "";
}

function hasDubClickId(order: ShopifyOrder): boolean {
  return order.customAttributes.some((attribute) => {
    const key = attribute.key.toLowerCase();
    return (key === "dubclickid" || key === "dub_id") && Boolean(attribute.value);
  });
}

function orderHasCode(order: ShopifyOrder, codes: string[]): boolean {
  const present = new Set(order.discountCodes.map((code) => code.toUpperCase()));
  return codes.some((code) => present.has(code));
}

function remember(
  orders: Map<string, MatchedOrder>,
  order: ShopifyOrder,
  reason: string,
): void {
  const existing = orders.get(order.id);
  if (existing) {
    existing.reasons.add(reason);
    return;
  }
  orders.set(order.id, { order, reasons: new Set([reason]) });
}

async function dubGet<T>(path: string): Promise<T> {
  const response = await fetch(`https://api.dub.co${path}`, {
    headers: {
      Authorization: `Bearer ${requireEnv("DUB_API_KEY")}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Dub API ${path} failed (${response.status}): ${body}`);
  }

  return response.json() as Promise<T>;
}

function centsToDollars(cents: number, currency: string): string {
  const amount = (cents / 100).toFixed(2);
  return `${amount} ${currency.toUpperCase()}`;
}

async function commissionsForOrder(order: ShopifyOrder): Promise<{
  commissions: DubCommission[];
  linkKey: string;
}> {
  if (!order.confirmationNumber) {
    return { commissions: [], linkKey: "" };
  }

  const byInvoice = await dubGet<DubCommission[]>(
    `/commissions?invoiceId=${encodeURIComponent(order.confirmationNumber)}`,
  );
  const sale = byInvoice[0];
  const customerId = sale?.customer?.id;
  if (!customerId) {
    return { commissions: byInvoice, linkKey: "" };
  }

  const [commissions, customer] = await Promise.all([
    dubGet<DubCommission[]>(
      `/commissions?customerId=${encodeURIComponent(customerId)}&pageSize=100`,
    ),
    dubGet<DubCustomer>(
      `/customers/${encodeURIComponent(customerId)}?includeExpandedFields=true`,
    ).catch(() => null),
  ]);

  return {
    commissions: commissions.length > 0 ? commissions : byInvoice,
    linkKey: customer?.link?.key ?? "",
  };
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

function printCsv(rows: AuditRow[]): void {
  const headers: Array<keyof AuditRow> = [
    "order",
    "email",
    "discounts",
    "dubClickId",
    "partner",
    "partnerEmail",
    "linkKey",
    "saleAmount",
    "earnings",
    "status",
    "commissionType",
    "match",
    "invoiceId",
    "subtotal",
  ];
  console.log(headers.join(","));
  for (const row of rows) {
    console.log(headers.map((header) => csvEscape(row[header])).join(","));
  }
}

async function main(): Promise<void> {
  loadLocalEnv();
  const codes = parseList(process.env.INTERNAL_DISCOUNT_CODES, "BTadmin99");
  const matched = new Map<string, MatchedOrder>();

  for (const code of codes) {
    for await (const order of paginateOrders(`discount_code:${code}`)) {
      if (orderHasCode(order, codes)) {
        remember(matched, order, "discount_code");
      }
    }
  }

  for await (const order of paginateOrders("Brandon Taylor")) {
    if (isBrandonTaylorBilling(order)) {
      remember(matched, order, "billing_name");
    }
  }

  const rows: AuditRow[] = [];
  const orders = [...matched.values()].sort((a, b) =>
    a.order.name.localeCompare(b.order.name, undefined, { numeric: true }),
  );

  for (const { order, reasons } of orders) {
    const email = orderEmail(order);
    const base = {
      order: order.name,
      email,
      discounts: order.discountCodes.join(" "),
      dubClickId: hasDubClickId(order) ? "yes" : "no",
      match: [...reasons].sort().join("+"),
      invoiceId: order.confirmationNumber ?? "",
      subtotal: order.currentSubtotalPriceSet
        ? `${order.currentSubtotalPriceSet.shopMoney.amount} ${order.currentSubtotalPriceSet.shopMoney.currencyCode}`
        : "",
    };

    let commissions: DubCommission[] = [];
    let linkKey = "";
    if (order.confirmationNumber) {
      const found = await commissionsForOrder(order);
      commissions = found.commissions;
      linkKey = found.linkKey;
    }

    if (commissions.length === 0) {
      rows.push({
        ...base,
        partner: "",
        partnerEmail: "",
        linkKey,
        saleAmount: "",
        earnings: "",
        status: order.confirmationNumber ? "none" : "no_confirmation_number",
        commissionType: "",
      });
      continue;
    }

    for (const commission of commissions) {
      rows.push({
        ...base,
        partner: commission.partner?.name ?? "",
        partnerEmail: commission.partner?.email ?? "",
        linkKey,
        saleAmount: centsToDollars(commission.amount, commission.currency),
        earnings: centsToDollars(commission.earnings, commission.currency),
        status: commission.status,
        commissionType: commission.type ?? "",
      });
    }
  }

  printCsv(rows);

  const paid = rows.filter((row) => row.status === "paid").length;
  const none = rows.filter(
    (row) => row.status === "none" || row.status === "no_confirmation_number",
  ).length;
  console.error(
    `Orders: ${orders.length}. Rows: ${rows.length}. Paid commissions: ${paid}. Orders with no Dub commission: ${none}.`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
