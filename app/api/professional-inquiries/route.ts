import { created, fail, ok } from "@/lib/api";
import { requireRole, requireUser } from "@/lib/auth";
import { professionalInquirySchema } from "@/lib/validators";

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  let query = auth.adminClient
    .from("professional_inquiries")
    .select("*, client:profiles!professional_inquiries_client_id_fkey(id, first_name, last_name, avatar_url, phone_verified), professional:profiles!professional_inquiries_professional_id_fkey(id, first_name, last_name, avatar_url, phone_verified, professional_profiles(*, professional_categories(category:categories(*)), professional_services(*, category:categories(*)))), service:professional_services(*)")
    .order("updated_at", { ascending: false });

  if (auth.role === "client") query = query.eq("client_id", auth.userId);
  if (auth.role === "professional") query = query.eq("professional_id", auth.userId);

  const { data, error } = await query;
  if (error) return fail("Could not load inquiries", 400, error.message);

  return ok({ inquiries: data });
}

export async function POST(request: Request) {
  const auth = await requireRole(request, ["client"]);
  if (auth instanceof Response) return auth;

  const body = professionalInquirySchema.safeParse(await request.json());
  if (!body.success) return fail("Invalid inquiry payload", 422, body.error.flatten());
  if (body.data.professional_id === auth.userId) return fail("You cannot start an inquiry with yourself", 422);

  const { data: professional, error: professionalError } = await auth.adminClient
    .from("profiles")
    .select("id, first_name, last_name, role, is_active")
    .eq("id", body.data.professional_id)
    .eq("role", "professional")
    .eq("is_active", true)
    .single();

  if (professionalError || !professional) return fail("Professional not found", 404, professionalError?.message);

  if (body.data.service_id) {
    const { data: service, error: serviceError } = await auth.adminClient
      .from("professional_services")
      .select("id")
      .eq("id", body.data.service_id)
      .eq("professional_id", body.data.professional_id)
      .eq("is_active", true)
      .single();

    if (serviceError || !service) return fail("Service not found for this professional", 404, serviceError?.message);
  }

  const inquirySelect = "*, client:profiles!professional_inquiries_client_id_fkey(id, first_name, last_name, avatar_url, phone_verified), professional:profiles!professional_inquiries_professional_id_fkey(id, first_name, last_name, avatar_url, phone_verified, professional_profiles(*, professional_categories(category:categories(*)), professional_services(*, category:categories(*)))), service:professional_services(*)";

  let existingInquiryQuery = auth.adminClient
    .from("professional_inquiries")
    .select("id")
    .eq("client_id", auth.userId)
    .eq("professional_id", body.data.professional_id);

  existingInquiryQuery = body.data.service_id
    ? existingInquiryQuery.eq("service_id", body.data.service_id)
    : existingInquiryQuery.is("service_id", null);

  const { data: existingInquiry, error: existingInquiryError } = await existingInquiryQuery.maybeSingle();
  if (existingInquiryError) return fail("Could not check existing inquiry", 400, existingInquiryError.message);

  const inquiryMutation = existingInquiry
    ? auth.adminClient
      .from("professional_inquiries")
      .update({ status: "open" })
      .eq("id", existingInquiry.id)
    : auth.adminClient
      .from("professional_inquiries")
      .insert({
        client_id: auth.userId,
        professional_id: body.data.professional_id,
        service_id: body.data.service_id ?? null,
        status: "open"
      });

  const { data: inquiry, error: inquiryError } = await inquiryMutation
    .select(inquirySelect)
    .single();

  if (inquiryError || !inquiry) return fail("Could not start inquiry", 400, inquiryError?.message);

  const { data: message, error: messageError } = await auth.adminClient
    .from("messages")
    .insert({
      inquiry_id: inquiry.id,
      sender_id: auth.userId,
      receiver_id: body.data.professional_id,
      body: body.data.message
    })
    .select("*, sender:profiles!messages_sender_id_fkey(id, first_name, last_name, avatar_url), receiver:profiles!messages_receiver_id_fkey(id, first_name, last_name, avatar_url)")
    .single();

  if (messageError) return fail("Inquiry opened but message could not be sent", 400, messageError.message);

  await auth.adminClient.from("notifications").insert({
    user_id: body.data.professional_id,
    type: "professional_inquiry",
    title: "New professional inquiry",
    body: "A client sent you an inquiry from your profile.",
    data: {
      inquiry_id: inquiry.id,
      professional_id: body.data.professional_id,
      service_id: body.data.service_id ?? null
    },
    channel: "in_app"
  });

  return created({ inquiry, message });
}
