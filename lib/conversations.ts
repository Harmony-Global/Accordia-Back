export const conversationSelect = "*, job:jobs(id, title, status, is_remote, location, state, description, number_of_professionals, price_type, price_amount, currency, category:categories(*)), application:applications(id, status, pitch, proposed_rate, estimated_days, reference_image_urls, proposal_attachments), review:conversation_reviews(id, rating, review_text, skipped, created_at, updated_at), client:profiles!job_conversations_client_id_fkey(id, first_name, last_name, avatar_url, phone_verified), professional:profiles!job_conversations_professional_id_fkey(id, first_name, last_name, avatar_url, phone_verified, professional_profiles(*, professional_categories(category:categories(*)), professional_services(*, category:categories(*))))";

export function canUseConversation(
  conversation: { client_id: string; professional_id: string; status: string },
  auth: { role: string; userId: string }
) {
  return auth.role === "admin"
    || conversation.client_id === auth.userId
    || conversation.professional_id === auth.userId;
}

export function normalizeRelation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value ?? null;
}
