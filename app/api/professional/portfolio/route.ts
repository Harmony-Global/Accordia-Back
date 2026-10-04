import { created, fail, ok } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { portfolioBucket, signedPortfolio } from "@/lib/portfolio";
import { z } from "zod";

const entrySchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).nullable()
});
const fileTypes: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf"
};

export async function GET(request: Request) {
  const auth = await requireRole(request, ["professional"]);
  if (auth instanceof Response) return auth;
  try { return ok({ entries: await signedPortfolio(auth.adminClient, auth.userId) }); }
  catch (error) { return fail("Could not load portfolio", 400, String(error)); }
}

export async function POST(request: Request) {
  const auth = await requireRole(request, ["professional"]);
  if (auth instanceof Response) return auth;
  const form = await request.formData();
  const parsed = entrySchema.safeParse({
    title: form.get("title"), description: String(form.get("description") ?? "") || null
  });
  if (!parsed.success) return fail("Invalid portfolio entry", 422, parsed.error.flatten());
  const file = form.get("file");
  if (!(file instanceof File) || !fileTypes[file.type] || file.size < 1 || file.size > 5 * 1024 * 1024) {
    return fail("Choose a JPEG, PNG, WebP, or PDF file up to 5 MB", 422);
  }
  const path = `${auth.userId}/${crypto.randomUUID()}.${fileTypes[file.type]}`;
  const { error: uploadError } = await auth.adminClient.storage.from(portfolioBucket).upload(path, await file.arrayBuffer(), {
    contentType: file.type, upsert: false
  });
  if (uploadError) return fail("Could not upload portfolio file", 400, uploadError.message);
  const { data, error } = await auth.adminClient.from("professional_portfolio")
    .insert({ professional_id: auth.userId, ...parsed.data, file_path: path, mime_type: file.type })
    .select("id").single();
  if (error) {
    await auth.adminClient.storage.from(portfolioBucket).remove([path]);
    return fail("Could not save portfolio entry", 400, error.message);
  }
  return created({ id: data.id });
}
