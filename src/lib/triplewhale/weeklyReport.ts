import {
  ORDERS_SUMMARY_SQL,
  PLATFORM_ORDERS_SQL,
  SOURCE_ORDERS_SQL,
  SUBSCRIPTION_ORDERS_SQL,
} from "@/lib/triplewhale/weeklyReportQueries";
import {
  failureSlackPayload,
  renderWeeklyReport,
  type SlackPayload,
  type SourceMetric,
  type WeekMetrics,
} from "@/lib/triplewhale/weeklyReportMessage";
import { completedWeeks, type WeekWindow } from "@/lib/triplewhale/weeklyReportPeriod";

const SQL_URL = "https://api.triplewhale.com/api/v2/orcabase/api/sql";
const SHOP_ID_DEFAULT = "bodyiqhealth.myshopify.com";

const EMAIL_SMS = new Set([
  "email",
  "sms",
  "klaviyo",
  "attentive",
  "postscript",
  "omnisend",
  "smsbump",
]);

const PAID_MEDIUMS = new Set([
  "cpc",
  "ppc",
  "paid",
  "paid_social",
  "paidsocial",
  "cpm",
  "cpv",
]);

type Row = Record<string, unknown>;
type Bucket = "affiliate" | "emailSms" | "paid" | "directOrganic";

type SourceRow = {
  channel: string;
  utmSource: string;
  utmMedium: string;
  campaignName: string;
  revenue: number;
  orders: number;
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function dashboardUrl(): string {
  const url = requiredEnv("TW_DASHBOARD_URL");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("TW_DASHBOARD_URL is not a valid URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("TW_DASHBOARD_URL must be an http(s) URL");
  }
  return url;
}

function readNumber(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) throw new Error("Triple Whale returned a non-numeric metric");
  return n;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function oneRow(name: string, rows: Row[]): Row {
  if (rows.length > 1) throw new Error(`${name} returned ${rows.length} rows`);
  return rows[0] ?? {};
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * One attempt plus two retries. Logs the query name and status only.
 */
async function runQuery(name: string, query: string, period: WeekWindow): Promise<Row[]> {
  const apiKey = requiredEnv("TRIPLEWHALE_READ_API_KEY");
  const shopId = process.env.TRIPLEWHALE_SHOP_ID?.trim() || SHOP_ID_DEFAULT;
  let lastError = "query failed";

  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await sleep(attempt === 1 ? 500 : 1500);
      console.warn("[weekly-report] retrying", { query: name, attempt });
    }

    try {
      const res = await fetch(SQL_URL, {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify({
          shopId,
          query,
          currency: "USD",
          period: { startDate: period.startDate, endDate: period.endDate },
        }),
        signal: AbortSignal.timeout(12_000),
      });

      const body = (await res.json().catch(() => null)) as {
        success?: boolean;
        message?: unknown;
        data?: unknown;
      } | null;

      if (!res.ok || !body || body.success === false || !Array.isArray(body.data)) {
        lastError =
          typeof body?.message === "string" ? publicError(body.message) : `HTTP ${res.status}`;
        console.warn("[weekly-report] query failed", { query: name, status: res.status, attempt });
        continue;
      }

      return body.data as Row[];
    } catch (error) {
      lastError = error instanceof Error ? publicError(error.name) : "network error";
      console.warn("[weekly-report] query failed", { query: name, attempt });
    }
  }

  throw new Error(`${name} failed: ${lastError}`);
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}

function bucketFor(row: SourceRow): Bucket {
  const source = normalizeToken(row.utmSource);
  const channel = normalizeToken(row.channel);
  const medium = normalizeToken(row.utmMedium);

  if (source === "dub") return "affiliate";
  if (
    EMAIL_SMS.has(source) ||
    EMAIL_SMS.has(channel) ||
    medium === "email" ||
    medium === "sms" ||
    channel.includes("email") ||
    channel.includes("sms")
  ) {
    return "emailSms";
  }
  if (channel.endsWith("-ads") || PAID_MEDIUMS.has(medium)) return "paid";
  return "directOrganic";
}

/** Campaign labels only. Drops anything that looks like an email address. */
export function partnerLabel(name: string): string | null {
  const cleaned = name
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[*_~`]/g, "")
    .trim()
    .replace(/\s+/g, " ");
  if (!cleaned || cleaned.includes("@")) return null;
  return cleaned
    .slice(0, 80)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function publicError(message: string): string {
  return message.replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "[redacted]").slice(0, 300);
}

function emptySource(): SourceMetric {
  return { revenue: null, share: null, topPartner: null };
}

function sourceMetric(
  revenue: number,
  orders: number,
  totalRevenue: number,
  topPartner: string | null,
): SourceMetric {
  if (orders <= 0 && revenue === 0) return emptySource();
  return {
    revenue,
    share: totalRevenue > 0 ? revenue / totalRevenue : null,
    topPartner,
  };
}

function topPartner(rows: SourceRow[]): string | null {
  const totals = new Map<string, { label: string; revenue: number }>();
  for (const row of rows) {
    const label = partnerLabel(row.campaignName);
    if (!label) continue;
    const key = label.toLowerCase();
    const existing = totals.get(key);
    if (existing) existing.revenue += row.revenue;
    else totals.set(key, { label, revenue: row.revenue });
  }

  const ranked = [...totals.values()].sort(
    (a, b) => b.revenue - a.revenue || a.label.localeCompare(b.label),
  );
  return ranked[0]?.label ?? null;
}

export function weekMetricsFromRows(input: {
  orders: Row[];
  subscriptions: Row[];
  platforms: Row[];
  sources: Row[];
}): WeekMetrics {
  const orders = oneRow("orders", input.orders);
  const subscriptions = oneRow("subscriptions", input.subscriptions);
  const orderCount = readNumber(orders.orders);
  const orderRevenue = readNumber(orders.order_revenue);
  const hasOrders = orderCount > 0;

  const platformTotal = (name: string) =>
    input.platforms.reduce<{ revenue: number; orders: number }>(
      (sum, row) => {
        if (readString(row.platform).trim().toLowerCase() !== name) return sum;
        sum.revenue += readNumber(row.order_revenue);
        sum.orders += readNumber(row.orders);
        return sum;
      },
      { revenue: 0, orders: 0 },
    );

  const telehealth = platformTotal("carevalidate");
  const supplements = platformTotal("shopify");
  const autoshipOrders = readNumber(subscriptions.orders);

  const sourceRows: SourceRow[] = input.sources.map((row) => ({
    channel: readString(row.channel),
    utmSource: readString(row.utm_source),
    utmMedium: readString(row.utm_medium),
    campaignName: readString(row.campaign_name),
    revenue: readNumber(row.order_revenue),
    orders: readNumber(row.orders_quantity),
  }));

  const buckets: Record<Bucket, { revenue: number; orders: number; rows: SourceRow[] }> = {
    affiliate: { revenue: 0, orders: 0, rows: [] },
    emailSms: { revenue: 0, orders: 0, rows: [] },
    paid: { revenue: 0, orders: 0, rows: [] },
    directOrganic: { revenue: 0, orders: 0, rows: [] },
  };

  for (const row of sourceRows) {
    const bucket = buckets[bucketFor(row)];
    bucket.revenue += row.revenue;
    bucket.orders += row.orders;
    bucket.rows.push(row);
  }

  const slice = (orders: number, revenue: number) =>
    orders > 0 ? { orders, revenue } : { orders: null, revenue: null };

  const telehealthSlice = slice(telehealth.orders, telehealth.revenue);
  const supplementsSlice = slice(supplements.orders, supplements.revenue);

  return {
    revenue: hasOrders ? orderRevenue : null,
    orders: hasOrders ? orderCount : null,
    aov: hasOrders
      ? (orderRevenue - readNumber(orders.shipping_price) - readNumber(orders.taxes)) / orderCount
      : null,
    newCustomers: hasOrders ? readNumber(orders.new_customer_orders) : null,
    telehealthRevenue: telehealthSlice.revenue,
    telehealthOrders: telehealthSlice.orders,
    supplementsRevenue: supplementsSlice.revenue,
    supplementsOrders: supplementsSlice.orders,
    autoshipOrders: autoshipOrders > 0 ? autoshipOrders : null,
    returningRevenuePct:
      orderRevenue > 0 ? readNumber(orders.returning_customer_revenue) / orderRevenue : null,
    newOrders: hasOrders ? readNumber(orders.new_customer_orders) : null,
    returningOrders: hasOrders ? readNumber(orders.returning_customer_orders) : null,
    directOrganic: sourceMetric(buckets.directOrganic.revenue, buckets.directOrganic.orders, orderRevenue, null),
    affiliate: sourceMetric(
      buckets.affiliate.revenue,
      buckets.affiliate.orders,
      orderRevenue,
      topPartner(buckets.affiliate.rows),
    ),
    emailSms: sourceMetric(buckets.emailSms.revenue, buckets.emailSms.orders, orderRevenue, null),
    paid: sourceMetric(buckets.paid.revenue, buckets.paid.orders, orderRevenue, null),
  };
}

async function loadWeek(period: WeekWindow, suffix: string): Promise<WeekMetrics> {
  const [orders, subscriptions, platforms, sources] = await Promise.all([
    runQuery(`orders${suffix}`, ORDERS_SUMMARY_SQL, period),
    runQuery(`subscriptions${suffix}`, SUBSCRIPTION_ORDERS_SQL, period),
    runQuery(`platforms${suffix}`, PLATFORM_ORDERS_SQL, period),
    runQuery(`sources${suffix}`, SOURCE_ORDERS_SQL, period),
  ]);

  return weekMetricsFromRows({ orders, subscriptions, platforms, sources });
}

export async function buildWeeklyReport(now: Date): Promise<SlackPayload> {
  const weeks = completedWeeks(now);
  const [current, previous] = await Promise.all([
    loadWeek(weeks.current, ""),
    loadWeek(weeks.previous, "-prior"),
  ]);

  return renderWeeklyReport({
    label: weeks.label,
    current,
    previous,
    dashboardUrl: dashboardUrl(),
  });
}

export async function postSlackPayload(payload: SlackPayload): Promise<void> {
  const url = requiredEnv("SLACK_WEEKLY_REPORT_WEBHOOK_URL");
  const res = await fetch(url, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`Slack webhook failed: HTTP ${res.status}`);
  }
}

export async function postWeeklyReportFailure(): Promise<void> {
  const url = process.env.SLACK_WEEKLY_REPORT_WEBHOOK_URL?.trim();
  if (!url) {
    console.error("[weekly-report] failure notice skipped: webhook is not configured");
    return;
  }
  await postSlackPayload(failureSlackPayload());
}
