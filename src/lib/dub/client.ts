import { Dub } from "dub";
import { env } from "@/lib/env";

let dubClient: Dub | null = null;

export function getDubClient(): Dub {
  if (!dubClient) {
    dubClient = new Dub({ token: env.dubApiKey() });
  }
  return dubClient;
}

/** Raw fetch helper for Dub endpoints not yet exposed in the SDK (e.g. metadata passthrough). */
export async function dubFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`https://api.dub.co${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.dubApiKey()}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Dub API ${path} failed (${response.status}): ${body}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export type DubPartner = {
  id: string;
  partnerId: string;
  name: string;
  email: string | null;
  description?: string | null;
  tenantId?: string | null;
  groupId?: string | null;
  links?: Array<{
    key: string;
    shortLink: string;
    domain: string;
  }> | null;
};
