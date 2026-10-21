import crypto from "crypto";

import { env } from "@/lib/env";

export type PaystackPaymentStatus =
  | "abandoned"
  | "failed"
  | "ongoing"
  | "pending"
  | "processing"
  | "queued"
  | "reversed"
  | "success";

type PaystackInitializeResponse = {
  status: boolean;
  message: string;
  data?: {
    authorization_url: string;
    access_code: string;
    reference: string;
  };
};

export type PaystackTransactionData = {
  id?: number | string;
  status?: PaystackPaymentStatus | string;
  reference?: string;
  amount?: number;
  currency?: string;
  paid_at?: string | null;
  gateway_response?: string | null;
  customer?: {
    email?: string | null;
  } | null;
  metadata?: Record<string, unknown> | string | null;
};

type PaystackVerifyResponse = {
  status: boolean;
  message: string;
  data?: PaystackTransactionData;
};

export class PaystackError extends Error {
  constructor(message: string, public status = 502, public details?: unknown) {
    super(message);
    this.name = "PaystackError";
  }
}

export function isPaystackConfigured() {
  return Boolean(env.paystackSecretKey);
}

function requirePaystackSecret() {
  if (!env.paystackSecretKey) {
    throw new PaystackError("Paystack is not configured. Add PAYSTACK_SECRET_KEY to the backend environment.", 503);
  }

  return env.paystackSecretKey;
}

export function amountToSubunit(amount: number | string) {
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount < 0) {
    throw new PaystackError("Invalid payment amount", 422);
  }

  return Math.round(numericAmount * 100);
}

export function createPaystackReference(prefix: string) {
  return `ACC-${prefix}-${crypto.randomUUID().replace(/-/g, "")}`.toUpperCase();
}

export async function initializePaystackTransaction(payload: {
  amount: number;
  callbackUrl: string;
  currency: string;
  email: string;
  metadata: Record<string, unknown>;
  reference: string;
}) {
  const response = await fetch(`${env.paystackBaseUrl.replace(/\/$/, "")}/transaction/initialize`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requirePaystackSecret()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      amount: String(amountToSubunit(payload.amount)),
      callback_url: payload.callbackUrl,
      currency: payload.currency,
      email: payload.email,
      metadata: payload.metadata,
      reference: payload.reference
    })
  });

  const data = (await response.json().catch(() => null)) as PaystackInitializeResponse | null;
  if (!response.ok || !data?.status || !data.data?.authorization_url || !data.data.access_code) {
    throw new PaystackError(data?.message ?? "Could not initialize Paystack transaction", response.status || 502, data);
  }

  return data.data;
}

export async function verifyPaystackTransaction(reference: string) {
  const response = await fetch(`${env.paystackBaseUrl.replace(/\/$/, "")}/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: {
      Authorization: `Bearer ${requirePaystackSecret()}`
    }
  });

  const data = (await response.json().catch(() => null)) as PaystackVerifyResponse | null;
  if (!response.ok || !data?.status || !data.data) {
    throw new PaystackError(data?.message ?? "Could not verify Paystack transaction", response.status || 502, data);
  }

  return data.data;
}

export function verifyPaystackWebhookSignature(rawBody: string, signature: string | null) {
  if (!signature) return false;

  const hash = crypto
    .createHmac("sha512", requirePaystackSecret())
    .update(rawBody)
    .digest("hex");

  if (hash.length !== signature.length) return false;

  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(signature));
}

async function paystackJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${env.paystackBaseUrl.replace(/\/$/, "")}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${requirePaystackSecret()}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers
    }
  });
  const result = await response.json().catch(() => null) as { status?: boolean; message?: string; data?: T } | null;
  if (!response.ok || !result?.status || result.data === undefined) {
    throw new PaystackError(result?.message ?? "Paystack request failed", response.status || 502, result);
  }
  return result.data;
}

export type PaystackBank = { name: string; code: string; active?: boolean };
export type PaystackRecipient = {
  recipient_code: string;
  name: string;
  details?: { account_number?: string; bank_code?: string; bank_name?: string };
};
export type PaystackTransfer = {
  reference: string;
  amount: number;
  currency: string;
  status: string;
  transfer_code?: string;
  transferred_at?: string | null;
  updatedAt?: string | null;
  recipient?: PaystackRecipient | number | string;
};

export async function listPaystackBanks() {
  const banks: PaystackBank[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const batch = await paystackJson<PaystackBank[]>(`/bank?country=nigeria&currency=NGN&perPage=100&page=${page}`);
    banks.push(...batch);
    if (batch.length < 100) break;
  }
  return banks;
}

export function resolvePaystackAccount(bankCode: string, accountNumber: string) {
  return paystackJson<{ account_name: string; account_number: string; bank_id?: number }>(
    `/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`
  );
}

export function createPaystackRecipient(input: { name: string; account_number: string; bank_code: string }) {
  return paystackJson<PaystackRecipient>("/transferrecipient", {
    method: "POST",
    body: JSON.stringify({ type: "nuban", currency: "NGN", ...input })
  });
}

export function fetchPaystackRecipient(idOrCode: string) {
  return paystackJson<PaystackRecipient>(`/transferrecipient/${encodeURIComponent(idOrCode)}`);
}

export function verifyPaystackTransfer(reference: string) {
  return paystackJson<PaystackTransfer>(`/transfer/verify/${encodeURIComponent(reference)}`);
}
