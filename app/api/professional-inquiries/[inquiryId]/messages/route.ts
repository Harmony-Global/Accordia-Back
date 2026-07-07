import { created, fail, ok } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { conversationMessageSchema } from "@/lib/validators";

type Params = { params: { inquiryId: string } };

function canUseInquiry(
  inquiry: { client_id: string; professional_id: string; status: string },
  auth: { role: string; userId: string }
) {
  return auth.role === "admin"
    || inquiry.client_id === auth.userId
    || inquiry.professional_id === auth.userId;
}

export async function GET(request: Request, { params }: Params) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  const { data: inquiry, error: inquiryError } = await auth.adminClient
    .from("professional_inquiries")
    .select("id, client_id, professional_id, status")
    .eq("id", params.inquiryId)
    .single();

  if (inquiryError || !inquiry) return fail("Inquiry not found", 404, inquiryError?.message);
  if (!canUseInquiry(inquiry, auth)) return fail("Forbidden for this inquiry", 403);

  const { data, error } = await auth.adminClient
    .from("messages")
    .select("*, sender:profiles!messages_sender_id_fkey(id, first_name, last_name, avatar_url), receiver:profiles!messages_receiver_id_fkey(id, first_name, last_name, avatar_url)")
    .eq("inquiry_id", params.inquiryId)
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) return fail("Could not load inquiry messages", 400, error.message);
  return ok({ messages: data });
}

export async function POST(request: Request, { params }: Params) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  const body = conversationMessageSchema.safeParse(await request.json());
  if (!body.success) return fail("Invalid message payload", 422, body.error.flatten());

  const { data: inquiry, error: inquiryError } = await auth.adminClient
    .from("professional_inquiries")
    .select("id, client_id, professional_id, status")
    .eq("id", params.inquiryId)
    .single();

  if (inquiryError || !inquiry) return fail("Inquiry not found", 404, inquiryError?.message);
  if (!canUseInquiry(inquiry, auth)) return fail("Forbidden for this inquiry", 403);
  if (inquiry.status !== "open") return fail("This inquiry is not open", 409);

  const receiverId = inquiry.client_id === auth.userId
    ? inquiry.professional_id
    : inquiry.client_id;

  const { data, error } = await auth.adminClient
    .from("messages")
    .insert({
      inquiry_id: inquiry.id,
      sender_id: auth.userId,
      receiver_id: receiverId,
      body: body.data.body
    })
    .select("*, sender:profiles!messages_sender_id_fkey(id, first_name, last_name, avatar_url), receiver:profiles!messages_receiver_id_fkey(id, first_name, last_name, avatar_url)")
    .single();

  if (error) return fail("Could not send message", 400, error.message);

  await auth.adminClient.from("notifications").insert({
    user_id: receiverId,
    type: "professional_inquiry_message",
    title: "New inquiry message",
    body: "You have a new message in a professional inquiry.",
    data: {
      inquiry_id: inquiry.id
    },
    channel: "in_app"
  });

  return created({ message: data });
}
