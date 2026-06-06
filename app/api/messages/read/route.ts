import { fail, ok } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { markMessagesReadSchema } from "@/lib/validators";

export async function PATCH(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  const body = markMessagesReadSchema.safeParse(await request.json());
  if (!body.success) return fail("Invalid read payload", 422, body.error.flatten());

  let query = auth.adminClient
    .from("messages")
    .update({ is_read: true })
    .eq("receiver_id", auth.userId)
    .eq("job_id", body.data.job_id);

  if (body.data.sender_id) query = query.eq("sender_id", body.data.sender_id);

  const { error } = await query;
  if (error) return fail("Could not mark messages read", 400, error.message);
  return ok({ updated: true });
}
