import { env } from "@/lib/env";

type KlaviyoEventProperties = Record<string, string | number | boolean>;

export async function trackKlaviyoEvent(
  metricName: string,
  email: string,
  properties: KlaviyoEventProperties,
): Promise<void> {
  const response = await fetch("https://a.klaviyo.com/api/events/", {
    method: "POST",
    headers: {
      Authorization: `Klaviyo-API-Key ${env.klaviyoApiKey()}`,
      "Content-Type": "application/json",
      revision: "2024-10-15",
    },
    body: JSON.stringify({
      data: {
        type: "event",
        attributes: {
          metric: {
            data: {
              type: "metric",
              attributes: { name: metricName },
            },
          },
          profile: {
            data: {
              type: "profile",
              attributes: { email },
            },
          },
          properties,
        },
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Klaviyo event failed (${response.status}): ${body}`);
  }
}

export async function sendAffiliateApprovedEmail(params: {
  firstName: string;
  email: string;
  portalUrl: string;
  metadata: {
    code_10: string;
    link_10: string;
    code_15: string;
    link_15: string;
    code_20: string;
    link_20: string;
  };
}): Promise<void> {
  await trackKlaviyoEvent("affiliate_approved", params.email, {
    first_name: params.firstName,
    email: params.email,
    portal_url: params.portalUrl,
    code_10: params.metadata.code_10,
    link_10: params.metadata.link_10,
    code_15: params.metadata.code_15,
    link_15: params.metadata.link_15,
    code_20: params.metadata.code_20,
    link_20: params.metadata.link_20,
  });
}
