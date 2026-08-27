import { fail, ok } from "@/lib/api";
import { requireUser } from "@/lib/auth";

type Params = { params: { conversationId: string } };

export async function PATCH(request: Request, { params }: Params) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  const { data, error } = await auth.userClient.rpc("mark_conversation_messages_read", {
    p_conversation_id: params.conversationId
  });

  if (error) return fail("Could not mark conversation read", 400, error.message);
  return ok({ updated: data ?? 0 });
}
