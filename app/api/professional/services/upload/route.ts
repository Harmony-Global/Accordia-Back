import { created, fail } from "@/lib/api";
import { requireRole } from "@/lib/auth";

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const SERVICE_IMAGE_BUCKET = "professional-service-images";
const imageExtensions: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};

export async function POST(request: Request) {
  const auth = await requireRole(request, ["professional"]);
  if (auth instanceof Response) return auth;

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) return fail("An image file is required", 422);
  if (!imageExtensions[file.type]) return fail("Only JPEG, PNG, and WebP images are supported", 422);
  if (file.size === 0 || file.size > MAX_IMAGE_SIZE) return fail("Image must be between 1 byte and 5 MB", 422);

  const objectPath = `${auth.userId}/${crypto.randomUUID()}.${imageExtensions[file.type]}`;
  const { error } = await auth.adminClient.storage
    .from(SERVICE_IMAGE_BUCKET)
    .upload(objectPath, await file.arrayBuffer(), {
      contentType: file.type,
      upsert: false
    });

  if (error) return fail("Could not upload service image", 400, error.message);

  const { data } = auth.adminClient.storage
    .from(SERVICE_IMAGE_BUCKET)
    .getPublicUrl(objectPath);

  return created({
    image_url: data.publicUrl,
    path: objectPath
  });
}
