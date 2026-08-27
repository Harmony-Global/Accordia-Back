import { fail, ok } from "@/lib/api";
import { requireUser } from "@/lib/auth";

type Params = { params: { inquiryId: string } };

export async function PATCH(request: Request, { params }: Params) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  const { data, error } = await auth.userClient.rpc("mark_inquiry_messages_read", {
    p_inquiry_id: params.inquiryId
  });

  if (error) return fail("Could not mark inquiry read", 400, error.message);
  return ok({ updated: data ?? 0 });
}
