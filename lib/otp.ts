import { createHash, randomInt } from "crypto";

export function createOtpCode() {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function hashOtpCode(userId: string, phone: string, code: string) {
  return createHash("sha256").update(`${userId}:${phone}:${code}`).digest("hex");
}

export function otpExpiresAt(minutes = 10) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}
