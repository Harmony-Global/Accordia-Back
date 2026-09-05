import { created, fail, ok, parseSearchParams } from "@/lib/api";
import { requireRole, requireUser } from "@/lib/auth";
import { createJobSchema } from "@/lib/validators";

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  const params = parseSearchParams(request);
  const status = params.get("status");
  const mine = params.get("mine") === "true";

  let query = auth.userClient
    .from("jobs")
    .select(`
      *,
      categories(*),
      client:profiles!jobs_client_id_fkey(id, first_name, last_name, phone_verified),
      applications(
        id,
        job_id,
        professional_id,
        status,
        chat_invited_at,
        proposed_rate,
        deleted_at,
        created_at,
        updated_at,
        professional:profiles!applications_professional_id_fkey(
          id,
          first_name,
          last_name,
          phone_verified,
          avatar_url,
          professional_profiles(
            id,
            user_id,
            bio,
            years_experience,
            location,
            state,
            is_available,
            professional_categories(category:categories(id, name, slug, icon)),
            professional_services(
              id,
              professional_id,
              category_id,
              offering_type,
              title,
              description,
              image_url,
              price_min,
              price_max,
              currency,
              is_active,
              created_at,
              updated_at,
              category:categories(id, name, slug, icon)
            )
          )
        )
      )
    `)
    .order("created_at", { ascending: false })
    .limit(50);

  if (mine) query = query.eq("client_id", auth.userId);
  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) return fail("Could not load jobs", 400, error.message);

  const jobs = (data ?? []).map((job) => ({
    ...job,
    applications: (job.applications ?? []).filter((application: { deleted_at?: string | null }) => !application.deleted_at)
  }));

  if (mine && jobs.length) {
    const jobIds = jobs.map((job) => job.id);
    const { data: rejectedApplications, error: rejectedApplicationsError } = await auth.adminClient
      .from("applications")
      .select(`
        id,
        job_id,
        professional_id,
        status,
        chat_invited_at,
        proposed_rate,
        deleted_at,
        created_at,
        updated_at,
        professional:profiles!applications_professional_id_fkey(
          id,
          first_name,
          last_name,
          phone_verified,
          avatar_url,
          professional_profiles(
            id,
            user_id,
            bio,
            years_experience,
            location,
            state,
            is_available,
            professional_categories(category:categories(id, name, slug, icon)),
            professional_services(
              id,
              professional_id,
              category_id,
              offering_type,
              title,
              description,
              image_url,
              price_min,
              price_max,
              currency,
              is_active,
              created_at,
              updated_at,
              category:categories(id, name, slug, icon)
            )
          )
        )
      `)
      .in("job_id", jobIds)
      .in("status", ["rejected", "not_awarded"])
      .is("deleted_at", null)
      .order("updated_at", { ascending: false });

    if (rejectedApplicationsError) return fail("Could not load rejected applications", 400, rejectedApplicationsError.message);

    const rejectedByJob = new Map<string, typeof rejectedApplications>();
    for (const application of rejectedApplications ?? []) {
      rejectedByJob.set(application.job_id, [...(rejectedByJob.get(application.job_id) ?? []), application]);
    }

    return ok({
      jobs: jobs.map((job) => ({
        ...job,
        rejected_applications: rejectedByJob.get(job.id) ?? []
      }))
    });
  }

  return ok({ jobs });
}

export async function POST(request: Request) {
  const auth = await requireRole(request, ["client"]);
  if (auth instanceof Response) return auth;

  const body = createJobSchema.safeParse(await request.json());
  if (!body.success) return fail("Invalid job payload", 422, body.error.flatten());

  const { data: job, error } = await auth.adminClient
    .from("jobs")
    .insert({ ...body.data, client_id: auth.userId })
    .select("*")
    .single();

  if (error) return fail("Could not create job", 400, error.message);

  await auth.adminClient.from("job_progress").insert({
    job_id: job.id,
    status: "posted",
    note: "Client posted the job.",
    updated_by: auth.userId
  });

  return created({ job });
}
