import { fail } from "@/lib/api";
import type { AuthContext } from "@/lib/auth";
import { conversationSelect, normalizeRelation } from "@/lib/conversations";
import { env } from "@/lib/env";
import {
  amountToSubunit,
  createPaystackReference,
  initializePaystackTransaction,
  type PaystackTransactionData
} from "@/lib/paystack";

export type PaymentType = "job_upfront" | "job_final" | "appointment_full";

type AdminClient = AuthContext["adminClient"];

type PaymentRecord = {
  id: string;
  conversation_id: string | null;
  appointment_id: string | null;
  job_id: string | null;
  quote_id: string | null;
  payer_id: string;
  professional_id: string | null;
  payment_type: PaymentType;
  amount: number | string;
  currency: string;
  provider_reference: string;
  receipt_number?: string | null;
  status: string;
};

type JobPaymentConversation = {
  id: string;
  job_id: string;
  application_id: string;
  client_id: string;
  professional_id: string;
  status: string;
  work_status?: string | null;
  upfront_payment_made_at?: string | null;
  final_payment_made_at?: string | null;
  job?: {
    id: string;
    title?: string | null;
    number_of_professionals?: number | null;
    currency?: string | null;
  } | {
    id: string;
    title?: string | null;
    number_of_professionals?: number | null;
    currency?: string | null;
  }[] | null;
  client?: {
    id: string;
    email?: string | null;
  } | {
    id: string;
    email?: string | null;
  }[] | null;
};

type AcceptedQuote = {
  id: string;
  total_budget: number | string;
  project_title: string;
  job?: {
    currency?: string | null;
  } | {
    currency?: string | null;
  }[] | null;
};

type AppointmentPaymentPayload = {
  id: string;
  client_id: string;
  professional_id: string;
  service_id: string | null;
  status: string;
  payment_made_at?: string | null;
  payment_reference?: string | null;
  hired_at?: string | null;
  service?: {
    id: string;
    title?: string | null;
    price_min?: number | string | null;
    price_max?: number | string | null;
    currency?: string | null;
  } | {
    id: string;
    title?: string | null;
    price_min?: number | string | null;
    price_max?: number | string | null;
    currency?: string | null;
  }[] | null;
  client?: {
    id: string;
    email?: string | null;
  } | {
    id: string;
    email?: string | null;
  }[] | null;
};

type PaymentInitialization = {
  id: string;
  payment_type: PaymentType;
  amount: number;
  currency: string;
  provider_reference: string;
  authorization_url: string;
  access_code: string;
  status: string;
};

export class PaymentFlowError extends Error {
  constructor(message: string, public status = 400, public details?: unknown) {
    super(message);
    this.name = "PaymentFlowError";
  }
}

export function paymentFailure(error: unknown) {
  if (error instanceof PaymentFlowError) return fail(error.message, error.status, error.details);
  if (error instanceof Error) return fail(error.message, 400);
  return fail("Payment request failed", 400);
}

function roundCurrency(amount: number) {
  return Math.round(amount * 100) / 100;
}

function normalizePaymentAmount(amount: number | string) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) {
    throw new PaymentFlowError("Payment amount is not available for this transaction", 409);
  }

  return roundCurrency(value);
}

function buildPaymentCallbackUrl(request: Request, reference: string) {
  const origin = env.appFrontendUrl ?? request.headers.get("origin") ?? new URL(request.url).origin;
  const callbackUrl = new URL("/payment/callback", origin);
  callbackUrl.searchParams.set("reference", reference);
  return callbackUrl.toString();
}

function paymentStatusFromPaystack(status: string | undefined) {
  if (status === "success") return "success";
  if (status === "abandoned") return "abandoned";
  if (status === "failed" || status === "reversed") return "failed";
  return "pending";
}

function createReceiptNumber(paymentId: string) {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `ACC-RCPT-${date}-${paymentId.slice(0, 8).toUpperCase()}`;
}

async function loadAcceptedQuote(adminClient: AdminClient, conversationId: string) {
  const { data, error } = await adminClient
    .from("job_quotes")
    .select("id, total_budget, project_title, job:jobs(currency)")
    .eq("conversation_id", conversationId)
    .eq("status", "accepted")
    .maybeSingle<AcceptedQuote>();

  if (error) throw new PaymentFlowError("Could not verify accepted quote", 400, error.message);
  if (!data) throw new PaymentFlowError("A quote must be accepted before payment can continue.", 409);

  return data;
}

async function ensureHiringCapacity(adminClient: AdminClient, conversation: JobPaymentConversation) {
  const job = normalizeRelation(conversation.job);
  const professionalCap = Math.max(1, Number(job?.number_of_professionals ?? 1));
  const { count, error } = await adminClient
    .from("job_conversations")
    .select("id", { count: "exact", head: true })
    .eq("job_id", conversation.job_id)
    .not("upfront_payment_made_at", "is", null);

  if (error) throw new PaymentFlowError("Could not verify hiring capacity", 400, error.message);
  if ((count ?? 0) >= professionalCap) {
    throw new PaymentFlowError(`This request already has the required ${professionalCap} hired professional${professionalCap === 1 ? "" : "s"}.`, 409);
  }
}

export async function initializeJobPayment(auth: AuthContext, request: Request, conversationId: string, paymentType: Extract<PaymentType, "job_upfront" | "job_final">) {
  const { data: conversation, error: conversationError } = await auth.adminClient
    .from("job_conversations")
    .select("id, job_id, application_id, client_id, professional_id, status, work_status, upfront_payment_made_at, final_payment_made_at, job:jobs(id, title, number_of_professionals, currency), client:profiles!job_conversations_client_id_fkey(id, email)")
    .eq("id", conversationId)
    .single<JobPaymentConversation>();

  if (conversationError || !conversation) throw new PaymentFlowError("Conversation not found", 404, conversationError?.message);
  if (conversation.client_id !== auth.userId) throw new PaymentFlowError("Only the client can make this payment", 403);
  if (conversation.status !== "open") throw new PaymentFlowError("This conversation is not open", 409);

  const acceptedQuote = await loadAcceptedQuote(auth.adminClient, conversation.id);
  const totalAmount = normalizePaymentAmount(acceptedQuote.total_budget);
  const amount = paymentType === "job_upfront" ? roundCurrency(totalAmount * 0.5) : roundCurrency(totalAmount - roundCurrency(totalAmount * 0.5));

  if (paymentType === "job_upfront") {
    if (conversation.upfront_payment_made_at) throw new PaymentFlowError("Upfront payment has already been made", 409);
    await ensureHiringCapacity(auth.adminClient, conversation);
  } else {
    if (!conversation.upfront_payment_made_at) throw new PaymentFlowError("Upfront payment must be made first", 409);
    if (conversation.final_payment_made_at) throw new PaymentFlowError("Final payment has already been made", 409);
    if (conversation.work_status !== "submitted" && conversation.work_status !== "revision_requested") {
      throw new PaymentFlowError("Final payment is available after the professional submits deliverables", 409);
    }
  }

  const job = normalizeRelation(conversation.job);
  const client = normalizeRelation(conversation.client);
  const email = client?.email;
  if (!email) throw new PaymentFlowError("Client email is required before payment can continue", 409);

  const quoteJob = normalizeRelation(acceptedQuote.job);
  const currency = (quoteJob?.currency ?? job?.currency ?? env.paystackCurrency).toUpperCase();
  const reference = createPaystackReference(paymentType === "job_upfront" ? "JOB-UPFRONT" : "JOB-FINAL");
  const callbackUrl = buildPaymentCallbackUrl(request, reference);
  const metadata = {
    application_id: conversation.application_id,
    conversation_id: conversation.id,
    job_id: conversation.job_id,
    payment_type: paymentType,
    professional_id: conversation.professional_id,
    quote_id: acceptedQuote.id
  };

  const { data: payment, error: insertError } = await auth.adminClient
    .from("payments")
    .insert({
      amount,
      conversation_id: conversation.id,
      currency,
      job_id: conversation.job_id,
      metadata,
      payer_id: auth.userId,
      payment_type: paymentType,
      professional_id: conversation.professional_id,
      provider: "paystack",
      provider_reference: reference,
      quote_id: acceptedQuote.id,
      status: "initialized"
    })
    .select("id, payment_type, amount, currency, provider_reference, status")
    .single<PaymentRecord>();

  if (insertError || !payment) throw new PaymentFlowError("Could not prepare payment", 400, insertError?.message);

  try {
    const paystack = await initializePaystackTransaction({
      amount,
      callbackUrl,
      currency,
      email,
      metadata,
      reference
    });

    const { data: updatedPayment, error: updateError } = await auth.adminClient
      .from("payments")
      .update({
        access_code: paystack.access_code,
        authorization_url: paystack.authorization_url,
        raw_response: { initialize: paystack }
      })
      .eq("id", payment.id)
      .select("id, payment_type, amount, currency, provider_reference, authorization_url, access_code, status")
      .single<PaymentInitialization>();

    if (updateError || !updatedPayment) throw new PaymentFlowError("Could not save Paystack payment details", 400, updateError?.message);
    return updatedPayment;
  } catch (error) {
    await auth.adminClient
      .from("payments")
      .update({ status: "failed", raw_response: { initialize_error: error instanceof Error ? error.message : "Paystack initialization failed" } })
      .eq("id", payment.id);
    throw error;
  }
}

export async function initializeAppointmentPayment(auth: AuthContext, request: Request, appointmentId: string) {
  const { data: appointment, error: appointmentError } = await auth.adminClient
    .from("appointments")
    .select("id, client_id, professional_id, service_id, status, payment_made_at, service:professional_services(id, title, price_min, price_max, currency), client:profiles!appointments_client_id_fkey(id, email)")
    .eq("id", appointmentId)
    .single<AppointmentPaymentPayload>();

  if (appointmentError || !appointment) throw new PaymentFlowError("Appointment not found", 404, appointmentError?.message);
  if (appointment.client_id !== auth.userId) throw new PaymentFlowError("Only the client can pay for this appointment", 403);
  if (appointment.payment_made_at) throw new PaymentFlowError("This appointment has already been paid", 409);
  if (appointment.status !== "accepted") {
    throw new PaymentFlowError("The appointment must be accepted before hiring and payment can continue", 409);
  }

  const service = normalizeRelation(appointment.service);
  if (!service) throw new PaymentFlowError("This appointment must be linked to a priced service before payment can continue", 409);

  const priceMin = Number(service.price_min);
  const priceMax = Number(service.price_max);
  if (!Number.isFinite(priceMin) || priceMin <= 0) throw new PaymentFlowError("This service does not have a valid appointment price", 409);
  if (Number.isFinite(priceMax) && priceMax !== priceMin) {
    throw new PaymentFlowError("This service needs one fixed price before appointment payment can continue", 409);
  }

  const client = normalizeRelation(appointment.client);
  const email = client?.email;
  if (!email) throw new PaymentFlowError("Client email is required before payment can continue", 409);

  const amount = normalizePaymentAmount(priceMin);
  const currency = (service.currency ?? env.paystackCurrency).toUpperCase();
  const reference = createPaystackReference("APPOINTMENT");
  const callbackUrl = buildPaymentCallbackUrl(request, reference);
  const metadata = {
    appointment_id: appointment.id,
    payment_type: "appointment_full",
    professional_id: appointment.professional_id,
    service_id: appointment.service_id
  };

  const { data: payment, error: insertError } = await auth.adminClient
    .from("payments")
    .insert({
      amount,
      appointment_id: appointment.id,
      currency,
      metadata,
      payer_id: auth.userId,
      payment_type: "appointment_full",
      professional_id: appointment.professional_id,
      provider: "paystack",
      provider_reference: reference,
      status: "initialized"
    })
    .select("id, payment_type, amount, currency, provider_reference, status")
    .single<PaymentRecord>();

  if (insertError || !payment) throw new PaymentFlowError("Could not prepare appointment payment", 400, insertError?.message);

  try {
    const paystack = await initializePaystackTransaction({
      amount,
      callbackUrl,
      currency,
      email,
      metadata,
      reference
    });

    const { data: updatedPayment, error: updateError } = await auth.adminClient
      .from("payments")
      .update({
        access_code: paystack.access_code,
        authorization_url: paystack.authorization_url,
        raw_response: { initialize: paystack }
      })
      .eq("id", payment.id)
      .select("id, payment_type, amount, currency, provider_reference, authorization_url, access_code, status")
      .single<PaymentInitialization>();

    if (updateError || !updatedPayment) throw new PaymentFlowError("Could not save Paystack payment details", 400, updateError?.message);
    return updatedPayment;
  } catch (error) {
    await auth.adminClient
      .from("payments")
      .update({ status: "failed", raw_response: { initialize_error: error instanceof Error ? error.message : "Paystack initialization failed" } })
      .eq("id", payment.id);
    throw error;
  }
}

export async function settleSuccessfulPayment(adminClient: AdminClient, payment: PaymentRecord) {
  if (payment.payment_type === "appointment_full") {
    if (!payment.appointment_id) throw new PaymentFlowError("Payment is missing its appointment", 409);

    const { data: appointment, error: appointmentError } = await adminClient
      .from("appointments")
      .select("id, client_id, professional_id, service_id, status, payment_made_at, service:professional_services(title)")
      .eq("id", payment.appointment_id)
      .single<AppointmentPaymentPayload>();

    if (appointmentError || !appointment) throw new PaymentFlowError("Appointment not found for payment", 404, appointmentError?.message);
    if (appointment.status !== "accepted") {
      throw new PaymentFlowError("The appointment must be accepted before hiring and payment can continue", 409);
    }

    if (!appointment.payment_made_at) {
      const { error: updateError } = await adminClient
        .from("appointments")
        .update({
          hired_at: new Date().toISOString(),
          hired_by: payment.payer_id,
          payment_made_at: new Date().toISOString(),
          payment_made_by: payment.payer_id,
          payment_reference: payment.provider_reference
        })
        .eq("id", appointment.id);

      if (updateError) throw new PaymentFlowError("Could not record appointment payment", 400, updateError.message);

      const service = normalizeRelation(appointment.service);
      await adminClient.from("notifications").insert({
        user_id: appointment.professional_id,
        type: "appointment_payment_made",
        title: "Appointment payment made",
        body: `The client paid for the appointment${service?.title ? ` for "${service.title}"` : ""}.`,
        data: {
          appointment_id: appointment.id,
          payment_id: payment.id,
          service_id: appointment.service_id
        },
        channel: "in_app"
      });

      await adminClient.from("notifications").insert({
        user_id: appointment.client_id,
        type: "appointment_payment_confirmed",
        title: "Appointment payment confirmed",
        body: `Your appointment payment${service?.title ? ` for "${service.title}"` : ""} was successful. Your receipt is ready.`,
        data: {
          appointment_id: appointment.id,
          payment_id: payment.id,
          payment_reference: payment.provider_reference,
          service_id: appointment.service_id
        },
        channel: "in_app"
      });
    }

    const { data: updatedAppointment, error: updatedError } = await adminClient
      .from("appointments")
      .select("*, client:profiles!appointments_client_id_fkey(id, first_name, last_name, avatar_url, phone_verified), professional:profiles!appointments_professional_id_fkey(id, first_name, last_name, avatar_url, phone_verified, professional_profiles(*, professional_categories(category:categories(*)), professional_services(*, category:categories(*)))), service:professional_services(*), availability:professional_availability(*), reschedule_requests:appointment_reschedule_requests(*)")
      .eq("id", appointment.id)
      .single();

    if (updatedError || !updatedAppointment) throw new PaymentFlowError("Payment recorded, but appointment could not be refreshed", 400, updatedError?.message);
    return updatedAppointment;
  }

  if (payment.payment_type !== "job_upfront" && payment.payment_type !== "job_final") return null;
  if (!payment.conversation_id) throw new PaymentFlowError("Payment is missing its conversation", 409);

  const { data: conversation, error: conversationError } = await adminClient
    .from("job_conversations")
    .select("id, job_id, application_id, client_id, professional_id, status, upfront_payment_made_at, final_payment_made_at, job:jobs(title)")
    .eq("id", payment.conversation_id)
    .single<JobPaymentConversation>();

  if (conversationError || !conversation) throw new PaymentFlowError("Conversation not found for payment", 404, conversationError?.message);
  if (conversation.status !== "open") throw new PaymentFlowError("This conversation is not open", 409);

  const job = normalizeRelation(conversation.job);

  if (payment.payment_type === "job_upfront") {
    const alreadyPaid = Boolean(conversation.upfront_payment_made_at);

    if (!alreadyPaid) {
      const { error: paymentError } = await adminClient
        .from("job_conversations")
        .update({
          upfront_payment_made_at: new Date().toISOString(),
          upfront_payment_made_by: payment.payer_id
        })
        .eq("id", conversation.id);

      if (paymentError) throw new PaymentFlowError("Could not record upfront payment", 400, paymentError.message);

      const { error: applicationError } = await adminClient
        .from("applications")
        .update({ status: "selected" })
        .eq("id", conversation.application_id);

      if (applicationError) throw new PaymentFlowError("Could not hire professional", 400, applicationError.message);

      await adminClient.from("notifications").insert({
        user_id: conversation.professional_id,
        type: "professional_hired",
        title: "You have been hired",
        body: `The client made an upfront payment and hired you${job?.title ? ` for "${job.title}"` : ""}.`,
        data: {
          application_id: conversation.application_id,
          conversation_id: conversation.id,
          job_id: conversation.job_id,
          payment_id: payment.id
        },
        channel: "in_app"
      });
    }
  }

  if (payment.payment_type === "job_final") {
    const alreadyPaid = Boolean(conversation.final_payment_made_at);

    if (!alreadyPaid) {
      const { error: paymentError } = await adminClient
        .from("job_conversations")
        .update({
          final_payment_made_at: new Date().toISOString(),
          final_payment_made_by: payment.payer_id
        })
        .eq("id", conversation.id);

      if (paymentError) throw new PaymentFlowError("Could not record final payment", 400, paymentError.message);

      await adminClient.from("notifications").insert({
        user_id: conversation.professional_id,
        type: "final_payment_made",
        title: "Final payment made",
        body: `The client made the final payment${job?.title ? ` for "${job.title}"` : ""}.`,
        data: {
          application_id: conversation.application_id,
          conversation_id: conversation.id,
          job_id: conversation.job_id,
          payment_id: payment.id
        },
        channel: "in_app"
      });
    }
  }

  const { data: updatedConversation, error: updatedError } = await adminClient
    .from("job_conversations")
    .select(conversationSelect)
    .eq("id", conversation.id)
    .single();

  if (updatedError || !updatedConversation) throw new PaymentFlowError("Payment recorded, but conversation could not be refreshed", 400, updatedError?.message);
  return updatedConversation;
}

export async function applyPaystackPaymentData(adminClient: AdminClient, reference: string, transaction: PaystackTransactionData, source: "verify" | "webhook") {
  const { data: payment, error: paymentError } = await adminClient
    .from("payments")
    .select("id, conversation_id, appointment_id, job_id, quote_id, payer_id, professional_id, payment_type, amount, currency, provider_reference, receipt_number, status")
    .eq("provider", "paystack")
    .eq("provider_reference", reference)
    .single<PaymentRecord>();

  if (paymentError || !payment) throw new PaymentFlowError("Payment record not found", 404, paymentError?.message);

  const expectedAmount = amountToSubunit(payment.amount);
  const receivedAmount = Number(transaction.amount ?? 0);
  const expectedCurrency = payment.currency.toUpperCase();
  const receivedCurrency = String(transaction.currency ?? "").toUpperCase();
  const status = paymentStatusFromPaystack(String(transaction.status ?? ""));
  const now = new Date().toISOString();

  if (status === "success" && (receivedAmount !== expectedAmount || receivedCurrency !== expectedCurrency)) {
    await adminClient
      .from("payments")
      .update({
        raw_response: { [source]: transaction, mismatch: { expectedAmount, expectedCurrency, receivedAmount, receivedCurrency } },
        status: "failed",
        verified_at: source === "verify" ? now : undefined,
        webhook_received_at: source === "webhook" ? now : undefined
      })
      .eq("id", payment.id);
    throw new PaymentFlowError("Payment verification failed because amount or currency did not match", 409);
  }

  const { data: updatedPayment, error: updateError } = await adminClient
    .from("payments")
    .update({
      paid_at: status === "success" ? transaction.paid_at ?? now : null,
      provider_transaction_id: transaction.id ? String(transaction.id) : null,
      receipt_issued_at: status === "success" ? now : null,
      receipt_number: status === "success" ? payment.receipt_number ?? createReceiptNumber(payment.id) : null,
      raw_response: { [source]: transaction },
      status,
      verified_at: source === "verify" ? now : undefined,
      webhook_received_at: source === "webhook" ? now : undefined
    })
    .eq("id", payment.id)
    .select("id, conversation_id, appointment_id, job_id, quote_id, payer_id, professional_id, payment_type, amount, currency, provider_reference, receipt_number, status")
    .single<PaymentRecord>();

  if (updateError || !updatedPayment) throw new PaymentFlowError("Could not update payment status", 400, updateError?.message);

  const settledResource = status === "success" ? await settleSuccessfulPayment(adminClient, updatedPayment) : null;
  if (updatedPayment.payment_type === "appointment_full") {
    return { payment: updatedPayment, appointment: settledResource };
  }

  return { payment: updatedPayment, conversation: settledResource };
}
