import { fail, ok } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { listPaystackBanks, PaystackError } from "@/lib/paystack";

export async function GET(request: Request) {
  const auth = await requireRole(request, ["professional"]);
  if (auth instanceof Response) return auth;
  try {
    const banks = await listPaystackBanks();
    return ok({ banks: banks.filter((bank) => bank.active !== false).sort((a, b) => a.name.localeCompare(b.name)) });
  } catch (error) {
    return fail("Could not load banks", error instanceof PaystackError ? error.status : 502);
  }
}
