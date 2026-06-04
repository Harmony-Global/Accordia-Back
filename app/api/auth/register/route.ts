import { created, fail } from "@/lib/api";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabasePublic } from "@/lib/supabase/public";
import { z } from "zod";

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  phone: z.string().min(7),
  role: z.enum(["professional", "client"]),
  first_name: z.string().min(1),
  last_name: z.string().min(1)
});

export async function POST(request: Request) {
  const body = registerSchema.safeParse(await request.json());
  if (!body.success) return fail("Invalid registration payload", 422, body.error.flatten());

  const publicClient = createSupabasePublic();
  const adminClient = createSupabaseAdmin();

  const { data: authData, error: authError } = await publicClient.auth.signUp({
    email: body.data.email,
    password: body.data.password,
    options: {
      data: {
        phone: body.data.phone,
        role: body.data.role
      }
    }
  });

  if (authError || !authData.user) {
    return fail(authError?.message ?? "Could not create account", 400);
  }

  const { error: profileError } = await adminClient.from("profiles").insert({
    id: authData.user.id,
    email: body.data.email,
    phone: body.data.phone,
    role: body.data.role,
    first_name: body.data.first_name,
    last_name: body.data.last_name
  });

  if (profileError) {
    await adminClient.auth.admin.deleteUser(authData.user.id);
    return fail("Could not create profile", 400, profileError.message);
  }

  if (body.data.role === "professional") {
    const { error } = await adminClient.from("professional_profiles").insert({
      user_id: authData.user.id
    });
    if (error) return fail("Account created, but professional profile failed", 400, error.message);
  }

  return created({
    user: {
      id: authData.user.id,
      email: body.data.email,
      phone: body.data.phone,
      role: body.data.role
    },
    session: authData.session
  });
}
