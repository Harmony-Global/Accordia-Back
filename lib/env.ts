function readEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. Add it to the root .env file, then restart the Next.js dev server.`
    );
  }
  return value;
}

function readOptionalEnv(name: string) {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value : undefined;
}

export const env = {
  supabaseUrl: readEnv("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: readEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  supabaseServiceRoleKey: readEnv("SUPABASE_SERVICE_ROLE_KEY"),
  appFrontendUrl: readOptionalEnv("APP_FRONTEND_URL"),
  passwordResetRedirectUrl: readOptionalEnv("PASSWORD_RESET_REDIRECT_URL"),
  resendApiKey: readOptionalEnv("RESEND_API_KEY"),
  resendFromEmail: readOptionalEnv("RESEND_FROM_EMAIL")
};
