/**
 * Triple Whale Data-Out SQL for the Monday leadership report.
 *
 * One request covers both weeks. The API period is the prior Monday through
 * the current Sunday (@startDate / @endDate). The inner query only reads raw
 * columns and labels each row current or prior. The outer query groups by
 * that label with one level of aggregates. AOV, shares, and week-over-week
 * percentages are computed in TypeScript.
 *
 * The week split uses event_date, the same column the API period filters.
 * `orders` and the new/returning customer fields are Moby formulas, not
 * columns, so counts use order_id and the is_new_customer boolean.
 */

function reportDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Invalid report date");
  }
  return value;
}

function periodColumn(currentStart: string): string {
  const day = reportDate(currentStart);
  return `CASE WHEN event_date >= toDate('${day}') THEN 'current' ELSE 'prior' END AS period`;
}

export function ordersSummarySql(currentStart: string): string {
  return `
/* v2 */
SELECT
  period,
  count(distinct order_id) AS order_count,
  sum(order_revenue) AS revenue_total,
  sum(shipping_price) AS shipping_total,
  sum(taxes) AS tax_total,
  uniqExactIf(order_id, is_new_customer) AS new_customer_orders,
  uniqExactIf(order_id, NOT is_new_customer) AS returning_customer_orders,
  sumIf(order_revenue, NOT is_new_customer) AS returning_customer_revenue
FROM (
  SELECT
    order_id,
    order_revenue,
    shipping_price,
    taxes,
    is_new_customer,
    ${periodColumn(currentStart)}
  FROM orders_table
  WHERE event_date BETWEEN @startDate AND @endDate
) AS orders_raw
GROUP BY period
`.trim();
}

export function subscriptionOrdersSql(currentStart: string): string {
  return `
/* v2 */
SELECT
  period,
  count(distinct order_id) AS order_count
FROM (
  SELECT
    order_id,
    ${periodColumn(currentStart)}
  FROM orders_table
  WHERE event_date BETWEEN @startDate AND @endDate
    AND is_subscription_order = true
) AS subscription_orders_raw
GROUP BY period
`.trim();
}

export function platformOrdersSql(currentStart: string): string {
  return `
/* v2 */
SELECT
  period,
  platform,
  sum(order_revenue) AS revenue_total,
  count(distinct order_id) AS order_count
FROM (
  SELECT
    order_id,
    order_revenue,
    platform,
    ${periodColumn(currentStart)}
  FROM orders_table
  WHERE event_date BETWEEN @startDate AND @endDate
) AS platform_orders_raw
GROUP BY period, platform
`.trim();
}

export function sourceOrdersSql(currentStart: string): string {
  return `
/* v2 */
SELECT
  period,
  channel,
  utm_source,
  utm_medium,
  campaign_name,
  sum(order_revenue) AS revenue_total,
  sum(orders_quantity) AS quantity_total
FROM (
  SELECT
    order_revenue,
    orders_quantity,
    channel,
    utm_source,
    utm_medium,
    campaign_name,
    ${periodColumn(currentStart)}
  FROM pixel_orders_table
  WHERE event_date BETWEEN @startDate AND @endDate
    AND model = 'Triple Attribution'
) AS source_orders_raw
GROUP BY period, channel, utm_source, utm_medium, campaign_name
`.trim();
}
