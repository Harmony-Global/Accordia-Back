import { fail, ok } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { portfolioBucket } from "@/lib/portfolio";
import { z } from "zod";

type Params = { params: { entryId: string } };
const idSchema = z.string().uuid();
const editSchema = z.object({ title: z.string().trim().min(1).max(160), description: z.string().trim().max(2000).nullable() });
const fileTypes: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };

export async function POST(request: Request, { params }: Params) {
  const auth = await requireRole(request, ["professional"]);
  if (auth instanceof Response) return auth;
  if (!idSchema.safeParse(params.entryId).success) return fail("Invalid portfolio entry", 422);
  const form = await request.formData();
  const parsed = editSchema.safeParse({ title: form.get("title"), description: String(form.get("description") ?? "") || null });
  if (!parsed.success) return fail("Invalid portfolio entry", 422, parsed.error.flatten());
  const file = form.get("file");
  if (file instanceof File && file.size > 0 && (!fileTypes[file.type] || file.size > 5 * 1024 * 1024)) {
    return fail("Choose a JPEG, PNG, WebP, or PDF file up to 5 MB", 422);
  }
  const { data: existing, error: loadError } = await auth.adminClient.from("professional_portfolio")
    .select("file_path").eq("id", params.entryId).eq("professional_id", auth.userId).single();
  if (loadError || !existing) return fail("Portfolio entry not found", 404);
  let path: string | undefined;
  if (file instanceof File && file.size > 0) {
    path = `${auth.userId}/${crypto.randomUUID()}.${fileTypes[file.type]}`;
    const { error: uploadError } = await auth.adminClient.storage.from(portfolioBucket)
      .upload(path, await file.arrayBuffer(), { contentType: file.type, upsert: false });
    if (uploadError) return fail("Could not upload portfolio file", 400, uploadError.message);
  }
  const { error } = await auth.adminClient.from("professional_portfolio")
    .update({ ...parsed.data, ...(path ? { file_path: path, mime_type: (file as File).type } : {}) })
    .eq("id", params.entryId).eq("professional_id", auth.userId);
  if (error) {
    if (path) await auth.adminClient.storage.from(portfolioBucket).remove([path]);
    return fail("Could not update portfolio entry", 400, error.message);
  }
  if (path) await auth.adminClient.storage.from(portfolioBucket).remove([existing.file_path]);
  return ok({ updated: true });
}

export async function PATCH(request: Request, { params }: Params) {
  const auth = await requireRole(request, ["professional"]);
  if (auth instanceof Response) return auth;
  if (!idSchema.safeParse(params.entryId).success) return fail("Invalid portfolio entry", 422);
  const parsed = editSchema.safeParse(await request.json());
  if (!parsed.success) return fail("Invalid portfolio entry", 422, parsed.error.flatten());
  const { data, error } = await auth.adminClient.from("professional_portfolio")
    .update(parsed.data).eq("id", params.entryId).eq("professional_id", auth.userId).select("id").single();
  if (error || !data) return fail("Could not update portfolio entry", 404, error?.message);
  return ok({ updated: true });
}

export async function DELETE(request: Request, { params }: Params) {
  const auth = await requireRole(request, ["professional"]);
  if (auth instanceof Response) return auth;
  if (!idSchema.safeParse(params.entryId).success) return fail("Invalid portfolio entry", 422);
  const { data: entry, error: loadError } = await auth.adminClient.from("professional_portfolio")
    .select("file_path").eq("id", params.entryId).eq("professional_id", auth.userId).single();
  if (loadError || !entry) return fail("Portfolio entry not found", 404);
  const { error } = await auth.adminClient.from("professional_portfolio")
    .delete().eq("id", params.entryId).eq("professional_id", auth.userId);
  if (error) return fail("Could not remove portfolio entry", 400, error.message);
  await auth.adminClient.storage.from(portfolioBucket).remove([entry.file_path]);
  return ok({ deleted: true });
}
