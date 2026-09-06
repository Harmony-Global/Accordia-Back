import { created, fail } from "@/lib/api";
import { requireUser } from "@/lib/auth";

const AVATAR_BUCKET = "profile-avatars";
const MAX_AVATAR_SIZE = 2 * 1024 * 1024;
const imageExtensions: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (auth instanceof Response) return auth;

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) return fail("An avatar image is required", 422);
  if (!imageExtensions[file.type]) return fail("Only JPEG, PNG, and WebP images are supported", 422);
  if (file.size === 0 || file.size > MAX_AVATAR_SIZE) return fail("Avatar must be between 1 byte and 2 MB", 422);

  const objectPath = `${auth.userId}/${crypto.randomUUID()}.${imageExtensions[file.type]}`;
  const { error: uploadError } = await auth.adminClient.storage
    .from(AVATAR_BUCKET)
    .upload(objectPath, await file.arrayBuffer(), {
      contentType: file.type,
      upsert: false
    });

  if (uploadError) return fail("Could not upload avatar", 400, uploadError.message);

  const { data } = auth.adminClient.storage
    .from(AVATAR_BUCKET)
    .getPublicUrl(objectPath);

  const { error: profileError } = await auth.adminClient
    .from("profiles")
    .update({ avatar_url: data.publicUrl })
    .eq("id", auth.userId)
    .eq("is_active", true);

  if (profileError) return fail("Could not save avatar", 400, profileError.message);

  return created({
    avatar_url: data.publicUrl,
    path: objectPath
  });
}
