const NO_DATA = "No data yet";

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const counts = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export type SourceMetric = {
  revenue: number | null;
  /** Share of total order revenue, 0–1. */
  share: number | null;
  topPartner: string | null;
};

export type WeekMetrics = {
  revenue: number | null;
  orders: number | null;
  aov: number | null;
  newCustomers: number | null;
  telehealthRevenue: number | null;
  telehealthOrders: number | null;
  supplementsRevenue: number | null;
  supplementsOrders: number | null;
  autoshipOrders: number | null;
  /** Returning-customer revenue / total revenue, 0–1. */
  returningRevenuePct: number | null;
  newOrders: number | null;
  returningOrders: number | null;
  directOrganic: SourceMetric;
  affiliate: SourceMetric;
  emailSms: SourceMetric;
  paid: SourceMetric;
  unattributed: SourceMetric;
};

type Mrkdwn = { type: "mrkdwn"; text: string };
type PlainText = { type: "plain_text"; text: string; emoji: false };

export type SlackBlock =
  | { type: "header"; text: PlainText }
  | { type: "section"; text: Mrkdwn }
  | { type: "divider" }
  | { type: "context"; elements: Mrkdwn[] }
  | {
      type: "actions";
      elements: Array<{
        type: "button";
        text: PlainText;
        url: string;
        action_id: string;
      }>;
    };

export type SlackPayload = {
  text: string;
  blocks: SlackBlock[];
  unfurl_links: false;
  unfurl_media: false;
};

type MetricKind = "money" | "count" | "percent";

type LookMetric = {
  label: string;
  kind: MetricKind;
  current: number | null;
  previous: number | null;
};

const WORTH_A_LOOK: Array<{ label: string; key: keyof WeekMetrics; kind: MetricKind }> = [
  { label: "Revenue", key: "revenue", kind: "money" },
  { label: "Orders", key: "orders", kind: "count" },
  { label: "AOV (before shipping & tax)", key: "aov", kind: "money" },
  { label: "New customers", key: "newCustomers", kind: "count" },
  { label: "Telehealth revenue", key: "telehealthRevenue", kind: "money" },
  { label: "Supplements revenue", key: "supplementsRevenue", kind: "money" },
  { label: "Autoship orders", key: "autoshipOrders", kind: "count" },
  { label: "Returning-customer revenue", key: "returningRevenuePct", kind: "percent" },
  { label: "New orders", key: "newOrders", kind: "count" },
  { label: "Returning orders", key: "returningOrders", kind: "count" },
];

const SOURCE_LOOK: Array<{ label: string; key: keyof WeekMetrics; kind: MetricKind }> = [
  { label: "Direct / organic revenue", key: "directOrganic", kind: "money" },
  { label: "Affiliate revenue", key: "affiliate", kind: "money" },
  { label: "Email / SMS revenue", key: "emailSms", kind: "money" },
  { label: "Paid revenue", key: "paid", kind: "money" },
  { label: "Unattributed revenue", key: "unattributed", kind: "money" },
];

function section(text: string): SlackBlock {
  return { type: "section", text: { type: "mrkdwn", text } };
}

export function formatMoney(value: number): string {
  return currency.format(value);
}

export function formatCount(value: number): string {
  return counts.format(Math.round(value));
}

export function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

/** Relative week-over-week change. Null when either week has no data or the prior week is 0. */
export function percentChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  const change = (current - previous) / Math.abs(previous);
  return Number.isFinite(change) ? change : null;
}

export function formatChange(change: number): string {
  if (change === 0) return "0.0%";
  const arrow = change > 0 ? "▲" : "▼";
  return `${arrow} ${formatPercent(Math.abs(change))}`;
}

function metricValue(metrics: WeekMetrics, key: keyof WeekMetrics): number | null {
  const value = metrics[key];
  if (typeof value === "number" || value === null) return value;
  return value.revenue;
}

function lookMetrics(current: WeekMetrics, previous: WeekMetrics): LookMetric[] {
  const specs = [...WORTH_A_LOOK, ...SOURCE_LOOK];
  return specs.map((spec) => ({
    label: spec.label,
    kind: spec.kind,
    current: metricValue(current, spec.key),
    previous: metricValue(previous, spec.key),
  }));
}

function formatLookValue(kind: MetricKind, value: number): string {
  if (kind === "count") return formatCount(value);
  if (kind === "percent") return formatPercent(value);
  return formatMoney(value);
}

function formatLookChange(change: number): string {
  const pct = Math.abs(change) * 100;
  const rounded = Math.round(pct * 10) / 10;
  const text = Math.abs(rounded - Math.round(rounded)) < 0.001 ? String(Math.round(rounded)) : rounded.toFixed(1);
  if (change === 0) return "0%";
  return `${change > 0 ? "▲" : "▼"}${text}%`;
}

/** Prior counts under 3, dollars under $3, or rates under 3 percentage points. */
function priorTooSmall(kind: MetricKind, previous: number): boolean {
  if (kind === "percent") return previous * 100 < 3;
  return previous < 3;
}

export function worthALook(current: WeekMetrics, previous: WeekMetrics): string[] {
  return lookMetrics(current, previous)
    .map((metric, index) => ({ metric, index, change: percentChange(metric.current, metric.previous) }))
    .filter((item): item is { metric: LookMetric; index: number; change: number } => {
      if (item.change === null || item.metric.previous === null || item.metric.current === null) return false;
      return !priorTooSmall(item.metric.kind, item.metric.previous);
    })
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change) || a.index - b.index)
    .slice(0, 2)
    .map((item) => {
      const prior = formatLookValue(item.metric.kind, item.metric.previous as number);
      const currentValue = formatLookValue(item.metric.kind, item.metric.current as number);
      return `${item.metric.label} ${prior} → ${currentValue} (${formatLookChange(item.change)})`;
    });
}

function moneyLine(label: string, revenue: number | null, extra: string[]): string {
  if (revenue === null) return `${label}  ${NO_DATA}`;
  const parts = [`*${formatMoney(revenue)}*`, ...extra];
  return `${label}  ${parts.join(" · ")}`;
}

function sourceLine(label: string, source: SourceMetric): string {
  if (source.revenue === null) return `${label}  ${NO_DATA}`;
  const extra: string[] = [];
  if (source.share !== null) extra.push(`${formatPercent(source.share)} of revenue`);
  if (label === "Affiliate" && source.topPartner) extra.push(`top partner *${source.topPartner}*`);
  return moneyLine(label, source.revenue, extra);
}

function businessLine(
  label: string,
  revenue: number | null,
  orders: number | null,
  share: number | null,
): string {
  if (revenue === null || orders === null) return `${label}  ${NO_DATA}`;
  const extra = [`${formatCount(orders)} orders`];
  if (share !== null) extra.push(`${formatPercent(share)} of revenue`);
  return moneyLine(label, revenue, extra);
}

export function renderWeeklyReport(input: {
  label: string;
  current: WeekMetrics;
  previous: WeekMetrics;
  dashboardUrl: string;
}): SlackPayload {
  const { label, current, previous, dashboardUrl } = input;
  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `BODYiQ Weekly · ${label}`, emoji: false },
    },
  ];

  if (current.revenue === null || current.orders === null) {
    blocks.push(section(NO_DATA));
  } else {
    const change = percentChange(current.revenue, previous.revenue);
    const comparison = change === null ? "" : `  ${formatChange(change)} vs last week`;
    blocks.push(section(`*${formatMoney(current.revenue)}*${comparison}`));
    const aov = current.aov === null ? NO_DATA : `*${formatMoney(current.aov)}*`;
    const newcomers = current.newCustomers === null ? NO_DATA : `*${formatCount(current.newCustomers)}*`;
    blocks.push(
      section(
        `Orders *${formatCount(current.orders)}*  ·  AOV (before shipping & tax) ${aov}  ·  New customers ${newcomers}`,
      ),
    );
  }

  const totalRevenue = current.revenue;
  const shareOf = (revenue: number | null) =>
    revenue !== null && totalRevenue !== null && totalRevenue > 0 ? revenue / totalRevenue : null;

  blocks.push(
    section(
      [
        "*Telehealth vs. supplements*",
        businessLine("Telehealth", current.telehealthRevenue, current.telehealthOrders, shareOf(current.telehealthRevenue)),
        businessLine("Supplements", current.supplementsRevenue, current.supplementsOrders, shareOf(current.supplementsRevenue)),
      ].join("\n"),
    ),
  );

  if (current.orders === null) {
    blocks.push(section(`*Subscriptions & repeat customers*\n${NO_DATA}`));
  } else {
    const autoship = current.autoshipOrders === null ? NO_DATA : `*${formatCount(current.autoshipOrders)}*`;
    const returning =
      current.returningRevenuePct === null ? NO_DATA : `*${formatPercent(current.returningRevenuePct)}*`;
    const mix =
      current.newOrders === null || current.returningOrders === null
        ? NO_DATA
        : `*${formatCount(current.newOrders)}* new · *${formatCount(current.returningOrders)}* returning`;
    blocks.push(
      section(
        [
          "*Subscriptions & repeat customers*",
          `Autoship orders  ${autoship}`,
          `Returning-customer revenue  ${returning}`,
          `New vs. returning orders  ${mix}`,
        ].join("\n"),
      ),
    );
  }

  const sources = [
    current.directOrganic,
    current.affiliate,
    current.emailSms,
    current.paid,
    current.unattributed,
  ];
  const sourceBody = sources.every((source) => source.revenue === null)
    ? NO_DATA
    : [
        sourceLine("Direct / organic", current.directOrganic),
        sourceLine("Affiliate", current.affiliate),
        sourceLine("Email / SMS", current.emailSms),
        sourceLine("Paid", current.paid),
        sourceLine("Unattributed", current.unattributed),
      ].join("\n");

  blocks.push(section(`*Where customers came from*\n${sourceBody}`));
  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: "Attribution tracking started Sep 30, 2026." }],
  });

  blocks.push({ type: "divider" });
  const highlights = worthALook(current, previous);
  blocks.push(
    section(
      highlights.length === 0
        ? `*Worth a look*\n${NO_DATA}`
        : `*Worth a look*\n${highlights.map((line) => `• ${line}`).join("\n")}`,
    ),
  );

  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: "Open full dashboard", emoji: false },
        url: dashboardUrl,
        action_id: "open_tw_dashboard",
      },
    ],
  });

  const revenueText =
    current.revenue === null ? "" : ` · ${formatMoney(current.revenue)}`;
  const change = percentChange(current.revenue, previous.revenue);
  const changeText = change === null ? "" : ` ${formatChange(change)}`;

  return {
    text: `BODYiQ Weekly · ${label}${revenueText}${changeText}`,
    blocks,
    unfurl_links: false,
    unfurl_media: false,
  };
}

export const FAILURE_SLACK_TEXT = "Weekly report failed to generate — check logs";

export function failureSlackPayload(): SlackPayload {
  return {
    text: FAILURE_SLACK_TEXT,
    blocks: [section(FAILURE_SLACK_TEXT)],
    unfurl_links: false,
    unfurl_media: false,
  };
}
