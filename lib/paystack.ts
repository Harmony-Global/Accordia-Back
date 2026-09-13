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
