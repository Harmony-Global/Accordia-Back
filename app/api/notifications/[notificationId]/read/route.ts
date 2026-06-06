import { fail, ok } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { notificationReadSchema } from "@/lib/validators";

type Params = { params: { notificationId: string } };

export async function PATCH(request: Request, { params }: Params) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  const body = notificationReadSchema.safeParse(await request.json());
  if (!body.success) return fail("Invalid notification payload", 422, body.error.flatten());

  const { data, error } = await auth.userClient.rpc("mark_notification_read", {
    p_notification_id: params.notificationId,
    p_is_read: body.data.is_read
  });

  if (error) return fail("Could not update notification", 400, error.message);
  return ok({ notification: data });
}
