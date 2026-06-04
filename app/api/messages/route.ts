import { created, fail, ok } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { messageSchema } from "@/lib/validators";

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  const { data, error } = await auth.userClient
    .from("messages")
    .select("*, sender:profiles!messages_sender_id_fkey(id, first_name, last_name), receiver:profiles!messages_receiver_id_fkey(id, first_name, last_name)")
    .or(`sender_id.eq.${auth.userId},receiver_id.eq.${auth.userId}`)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) return fail("Could not load messages", 400, error.message);
  return ok({ messages: data });
}

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  const body = messageSchema.safeParse(await request.json());
  if (!body.success) return fail("Invalid message payload", 422, body.error.flatten());

  const { data, error } = await auth.userClient
    .from("messages")
    .insert({
      sender_id: auth.userId,
      receiver_id: body.data.receiver_id,
      job_id: body.data.job_id ?? null,
      body: body.data.body
    })
    .select("*")
    .single();

  if (error) return fail("Could not send message", 400, error.message);
  return created({ message: data });
}
