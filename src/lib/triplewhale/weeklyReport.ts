import {
  ordersSummarySql,
  platformOrdersSql,
  sourceOrdersSql,
  subscriptionOrdersSql,
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

const QUERY_PAUSE_MS = 1000;
const RATE_LIMIT_BACKOFF_MS = [5_000, 15_000, 30_000];

/** Retry-After is seconds, or an HTTP date. Missing or unreadable falls through. */
function retryAfterMs(res: Response): number | null {
  const header = res.headers.get("retry-after")?.trim();
  if (!header) return null;

  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 30_000);

  const when = Date.parse(header);
  if (Number.isNaN(when)) return null;
  return Math.min(Math.max(0, when - Date.now()), 30_000);
}

/**
 * Non-429 failures: one try plus two retries (500ms, then 1500ms).
 * 429: up to 4 attempts, waiting on Retry-After or 5s / 15s / 30s.
 */
async function runQuery(name: string, query: string, period: WeekWindow): Promise<Row[]> {
  const apiKey = requiredEnv("TRIPLEWHALE_READ_API_KEY");
  const shopId = process.env.TRIPLEWHALE_SHOP_ID?.trim() || SHOP_ID_DEFAULT;
  let lastError = "query failed";
  let nextWait = 0;
  let sawRateLimit = false;

  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) {
      console.warn("[weekly-report] retrying", { query: name, attempt });
      await sleep(nextWait);
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

      const text = await res.text();
      let payload: unknown = null;
      if (text) {
        try {
          payload = JSON.parse(text) as unknown;
        } catch {
          payload = null;
        }
      }

      if (res.ok) {
        const rows = rowsFromSqlResponse(payload);
        if (rows) return rows;
      }

      const detail = failureMessage(payload);
      const snippet = responseSnippet(text);
      lastError = detail ? publicError(detail) : snippet || `HTTP ${res.status}`;
      console.warn("[weekly-report] query failed", {
        query: name,
        status: res.status,
        attempt,
        message: snippet || lastError,
      });

      if (res.status === 429) {
        sawRateLimit = true;
        nextWait = retryAfterMs(res) ?? RATE_LIMIT_BACKOFF_MS[Math.min(attempt, RATE_LIMIT_BACKOFF_MS.length - 1)];
        continue;
      }
    } catch (error) {
      lastError = error instanceof Error ? publicError(error.message) : "network error";
      console.warn("[weekly-report] query failed", { query: name, attempt, message: lastError });
    }

    if (!sawRateLimit && attempt >= 2) break;
    if (!sawRateLimit) nextWait = attempt === 0 ? 500 : 1500;
  }

  throw new Error(`${name} failed: ${lastError}`);
}

async function runQueriesInOrder(
  jobs: Array<{ name: string; query: string }>,
  period: WeekWindow,
): Promise<Row[][]> {
  const results: Row[][] = [];
  for (let index = 0; index < jobs.length; index++) {
    if (index > 0) await sleep(QUERY_PAUSE_MS);
    const job = jobs[index];
    results.push(await runQuery(job.name, job.query, period));
  }
  return results;
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}

function bucketFor(row: SourceRow): Bucket | "other" {
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
  if (isDirectOrganicChannel(channel)) return "directOrganic";
  return "other";
}

/** Pixel channel is Direct or an organic source. Blank and excluded channels are not. */
function isDirectOrganicChannel(channel: string): boolean {
  if (isUnattributedChannel(channel)) return false;
  if (channel === "direct" || channel.startsWith("direct-")) return true;
  return channel.includes("organic") || channel === "seo";
}

function isUnattributedChannel(channel: string): boolean {
  return (
    !channel ||
    channel === "unattributed" ||
    channel === "excluded" ||
    channel === "non-attributed" ||
    channel === "nonattributed" ||
    channel === "none"
  );
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

function responseSnippet(text: string): string {
  return text.replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "[redacted]").slice(0, 500);
}

type SqlPayload = {
  success?: boolean;
  message?: unknown;
  error?: unknown;
  exception?: unknown;
  data?: unknown;
};

function asRows(value: unknown): Row[] | null {
  return Array.isArray(value) ? (value as Row[]) : null;
}

/** Error text from a 200 body. Null when the payload is not reporting a failure. */
function failureMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const body = payload as SqlPayload;
  if (typeof body.error === "string" && body.error.trim()) return body.error;
  if (body.error && typeof body.error === "object") {
    const nested = body.error as { message?: unknown };
    if (typeof nested.message === "string" && nested.message.trim()) return nested.message;
  }
  if (typeof body.exception === "string" && body.exception.trim()) return body.exception;
  if (body.success === false) {
    return typeof body.message === "string" && body.message.trim() ? body.message : "Query failed";
  }
  return null;
}

/**
 * Documented success shape is `{ success, message, data: Row[] }`.
 * An empty `data` array, or `data: null` on success, is a valid empty result.
 * Some responses are the row array itself.
 */
function rowsFromSqlResponse(payload: unknown): Row[] | null {
  if (Array.isArray(payload)) return payload as Row[];
  if (!payload || typeof payload !== "object") return null;
  if (failureMessage(payload)) return null;

  const body = payload as SqlPayload;
  const dataRows = asRows(body.data);
  if (dataRows) return dataRows;

  if (body.data && typeof body.data === "object") {
    const nested = body.data as { rows?: unknown; data?: unknown };
    const nestedRows = asRows(nested.rows) ?? asRows(nested.data);
    if (nestedRows) return nestedRows;
  }

  if (body.success === true && body.data == null) return [];
  return null;
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
  const orderCount = readNumber(orders.order_count);
  const orderRevenue = readNumber(orders.revenue_total);
  const hasOrders = orderCount > 0;

  const platformTotal = (name: string) =>
    input.platforms.reduce<{ revenue: number; orders: number }>(
      (sum, row) => {
        if (readString(row.platform).trim().toLowerCase() !== name) return sum;
        sum.revenue += readNumber(row.revenue_total);
        sum.orders += readNumber(row.order_count);
        return sum;
      },
      { revenue: 0, orders: 0 },
    );

  const telehealth = platformTotal("carevalidate");
  const supplements = platformTotal("shopify");
  const autoshipOrders = readNumber(subscriptions.order_count);

  const sourceRows: SourceRow[] = input.sources.map((row) => ({
    channel: readString(row.channel),
    utmSource: readString(row.utm_source),
    utmMedium: readString(row.utm_medium),
    campaignName: readString(row.campaign_name),
    revenue: readNumber(row.revenue_total),
    orders: readNumber(row.quantity_total),
  }));

  const buckets: Record<Bucket, { revenue: number; orders: number; rows: SourceRow[] }> = {
    affiliate: { revenue: 0, orders: 0, rows: [] },
    emailSms: { revenue: 0, orders: 0, rows: [] },
    paid: { revenue: 0, orders: 0, rows: [] },
    directOrganic: { revenue: 0, orders: 0, rows: [] },
  };

  const other: { revenue: number; orders: number } = { revenue: 0, orders: 0 };
  let pixelRevenue = 0;
  let unattributedPixelRevenue = 0;
  for (const row of sourceRows) {
    pixelRevenue += row.revenue;
    const bucketName = bucketFor(row);
    if (bucketName === "other") {
      if (isUnattributedChannel(normalizeToken(row.channel))) {
        unattributedPixelRevenue += row.revenue;
      } else {
        other.revenue += row.revenue;
        other.orders += row.orders;
      }
      continue;
    }
    const bucket = buckets[bucketName];
    bucket.revenue += row.revenue;
    bucket.orders += row.orders;
    bucket.rows.push(row);
  }
  const missingFromPixel = Math.max(0, orderRevenue - pixelRevenue);
  const unattributedRevenue = missingFromPixel + unattributedPixelRevenue;
  const unattributedShown = unattributedRevenue > 0.005 ? unattributedRevenue : 0;

  const slice = (orders: number, revenue: number) =>
    orders > 0 ? { orders, revenue } : { orders: null, revenue: null };

  const telehealthSlice = slice(telehealth.orders, telehealth.revenue);
  const supplementsSlice = slice(supplements.orders, supplements.revenue);

  return {
    revenue: hasOrders ? orderRevenue : null,
    orders: hasOrders ? orderCount : null,
    aov: hasOrders
      ? (orderRevenue - readNumber(orders.shipping_total) - readNumber(orders.tax_total)) / orderCount
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
    other: sourceMetric(other.revenue, other.orders, orderRevenue, null),
    unattributed: sourceMetric(unattributedShown, 0, orderRevenue, null),
  };
}

const ORDER_FIELDS = [
  "revenue_total",
  "shipping_total",
  "tax_total",
  "order_count",
  "new_customer_orders",
  "returning_customer_orders",
  "returning_customer_revenue",
];

function rowsForPeriod(rows: Row[], period: "current" | "prior"): Row[] {
  return rows.filter((row) => readString(row.period) === period);
}

function sumFields(rows: Row[], fields: string[]): Row[] {
  if (rows.length === 0) return [];
  const total: Row = {};
  for (const field of fields) total[field] = 0;
  for (const row of rows) {
    for (const field of fields) total[field] = readNumber(total[field]) + readNumber(row[field]);
  }
  return [total];
}

function groupSum(rows: Row[], keys: string[], fields: string[]): Row[] {
  const groups = new Map<string, Row>();
  for (const row of rows) {
    const id = keys.map((key) => readString(row[key])).join("\u0000");
    let group = groups.get(id);
    if (!group) {
      group = {};
      for (const key of keys) group[key] = readString(row[key]);
      for (const field of fields) group[field] = 0;
      groups.set(id, group);
    }
    for (const field of fields) group[field] = readNumber(group[field]) + readNumber(row[field]);
  }
  return [...groups.values()];
}

function metricsForPeriod(
  period: "current" | "prior",
  orders: Row[],
  subscriptions: Row[],
  platforms: Row[],
  sources: Row[],
): WeekMetrics {
  return weekMetricsFromRows({
    orders: sumFields(rowsForPeriod(orders, period), ORDER_FIELDS),
    subscriptions: sumFields(rowsForPeriod(subscriptions, period), ["order_count"]),
    platforms: groupSum(rowsForPeriod(platforms, period), ["platform"], ["revenue_total", "order_count"]),
    sources: groupSum(
      rowsForPeriod(sources, period),
      ["channel", "utm_source", "utm_medium", "campaign_name"],
      ["revenue_total", "quantity_total"],
    ),
  });
}

export async function buildWeeklyReport(now: Date): Promise<SlackPayload> {
  const weeks = completedWeeks(now);
  const period = { startDate: weeks.previous.startDate, endDate: weeks.current.endDate };
  const currentStart = weeks.current.startDate;
  const [orders, subscriptions, platforms, sources] = await runQueriesInOrder(
    [
      { name: "orders", query: ordersSummarySql(currentStart) },
      { name: "subscriptions", query: subscriptionOrdersSql(currentStart) },
      { name: "platforms", query: platformOrdersSql(currentStart) },
      { name: "sources", query: sourceOrdersSql(currentStart) },
    ],
    period,
  );

  return renderWeeklyReport({
    label: weeks.label,
    current: metricsForPeriod("current", orders, subscriptions, platforms, sources),
    previous: metricsForPeriod("prior", orders, subscriptions, platforms, sources),
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
