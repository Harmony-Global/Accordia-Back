import { ok } from "@/lib/api";

export async function GET() {
  return ok({
    service: "accordia-backend",
    status: "ok",
    timestamp: new Date().toISOString()
  });
}
