import { env } from "@/lib/env";
import type { createSupabaseAdmin } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createSupabaseAdmin>;
type WelcomeRole = "client" | "professional" | "admin";

const nextSteps: Record<Exclude<WelcomeRole, "admin">, string> = {
  client: "Post your first job, review applicants, and award the right professionals when you are ready.",
  professional: "Complete your profile, choose your categories, and add at least five services or products so clients can understand your work."
};

function welcomeBody(firstName: string, role: WelcomeRole) {
  if (role === "admin") return `Welcome to Accordia, ${firstName}. Your admin workspace is ready.`;
  return `Welcome to Accordia, ${firstName}. ${nextSteps[role]}`;
}

function welcomeHtml(firstName: string, role: WelcomeRole) {
  const body = welcomeBody(firstName, role);

  return `
    <div style="font-family: Arial, sans-serif; color: #17212b; line-height: 1.6;">
      <h1 style="color: #16697a;">Welcome to Accordia</h1>
      <p>${body}</p>
      <p style="margin-top: 24px;">We are glad to have you here.</p>
    </div>
  `;
}

async function sendWelcomeEmail(input: {
  email: string;
  firstName: string;
  role: WelcomeRole;
}) {
  if (!env.resendApiKey || !env.resendFromEmail) return;

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.resendApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: env.resendFromEmail,
        to: input.email,
        subject: "Welcome to Accordia",
        html: welcomeHtml(input.firstName, input.role)
      })
    });

    if (!response.ok) {
      const details = await response.text().catch(() => "");
      console.warn("Welcome email failed", response.status, details);
    }
  } catch (error) {
    console.warn("Welcome email failed", error);
  }
}

export async function sendWelcomeMessage(input: {
  adminClient: AdminClient;
  userId: string;
  email: string;
  firstName: string;
  role: WelcomeRole;
}) {
  const body = welcomeBody(input.firstName, input.role);

  const { error } = await input.adminClient.from("notifications").insert({
    user_id: input.userId,
    type: "welcome",
    title: "Welcome to Accordia",
    body,
    data: {
      next_step: input.role === "professional" ? "/professional/categories" : "/dashboard"
    },
    channel: "in_app"
  });

  if (error) {
    console.warn("Could not create welcome notification", error.message);
  }

  await sendWelcomeEmail({
    email: input.email,
    firstName: input.firstName,
    role: input.role
  });
}
