import { z } from "zod";

export const CONTACT_INFO_MESSAGE = "For safety, keep communication inside Accordia. Do not share phone numbers, email addresses, or external contact links in messages.";

const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const phonePattern = /\+?\d[\d\s().-]{7,}\d/g;
const urlPattern = /\b(?:https?:\/\/|www\.)\S+/i;

function containsContactInfo(value: string) {
  if (emailPattern.test(value) || urlPattern.test(value)) return true;
  const candidates = value.match(phonePattern) ?? [];
  return candidates.some((candidate) => candidate.replace(/\D/g, "").length >= 9);
}

const safeMessageText = z
  .string()
  .min(1)
  .max(3000)
  .refine((value) => !containsContactInfo(value), CONTACT_INFO_MESSAGE);

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters and contain letters and numbers")
  .regex(/[A-Za-z]/, "Password must contain at least one letter")
  .regex(/\d/, "Password must contain at least one number");

export const profilePatchSchema = z.object({
  first_name: z.string().min(1).optional(),
  last_name: z.string().min(1).optional(),
  phone: z.string().min(7).optional(),
  avatar_url: z.string().url().nullable().optional()
}).strict();

export const professionalProfilePatchSchema = z.object({
  bio: z.string().max(2000).nullable().optional(),
  years_experience: z.number().int().min(0).optional(),
  location: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  is_available: z.boolean().optional()
}).strict();

const professionalServiceSchema = z.object({
  category_id: z.string().uuid().nullable().optional(),
  offering_type: z.enum(["service", "product"]).default("service"),
  title: z.string().min(3).max(160),
  description: z.string().min(10).max(3000),
  image_url: z.string().url().max(2048),
  price_min: z.number().min(0),
  price_max: z.number().min(0),
  currency: z.string().trim().min(3).max(3).transform((value) => value.toUpperCase()).default("NGN"),
  is_active: z.boolean().default(true)
}).strict();

export const professionalServiceCreateSchema = professionalServiceSchema.refine((data) => data.price_max >= data.price_min, {
  message: "Maximum price must be greater than or equal to minimum price",
  path: ["price_max"]
});

export const professionalServicePatchSchema = professionalServiceSchema
  .omit({ offering_type: true, currency: true, is_active: true })
  .partial()
  .extend({
    offering_type: z.enum(["service", "product"]).optional(),
    currency: z.string().trim().min(3).max(3).transform((value) => value.toUpperCase()).optional(),
    is_active: z.boolean().optional()
  })
  .strict();

export const setCategoriesSchema = z.object({
  category_ids: z.array(z.string().uuid()).min(1)
});

export const createJobSchema = z.object({
  category_id: z.string().uuid(),
  title: z.string().min(5).max(180),
  description: z.string().min(20),
  number_of_professionals: z.number().int().min(1).max(50).default(1),
  location: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  is_remote: z.boolean().default(false),
  start_date: z.string().nullable().optional(),
  end_date: z.string().nullable().optional()
}).strict();

export const updateJobSchema = createJobSchema.partial().strict();

export const applySchema = z.object({
  pitch: z.string().min(20).max(3000),
  proposed_rate: z.number().min(0).nullable().optional(),
  estimated_days: z.number().int().min(1).max(365).nullable().optional(),
  reference_image_urls: z.array(z.string().max(1_500_000)).min(1, "You need to attach supporting images for your application").max(3)
});

export const applicationPatchSchema = applySchema.partial().strict();

export const awardSchema = z.object({
  agreed_amount: z.number().min(0).nullable().optional()
});

export const messageSchema = z.object({
  receiver_id: z.string().uuid(),
  job_id: z.string().uuid(),
  application_id: z.string().uuid().nullable().optional(),
  body: safeMessageText
});

export const conversationMessageSchema = z.object({
  body: safeMessageText
});

export const revisionRequestSchema = z.object({
  note: z.string().min(10).max(2000)
}).strict();

export const professionalInquirySchema = z.object({
  professional_id: z.string().uuid(),
  service_id: z.string().uuid().nullable().optional(),
  message: safeMessageText
});

export const availabilityCreateSchema = z.object({
  service_id: z.string().uuid().nullable().optional(),
  starts_at: z.string().datetime(),
  ends_at: z.string().datetime(),
  note: z.string().max(1000).nullable().optional()
});

export const appointmentCreateSchema = z.object({
  availability_id: z.string().uuid(),
  service_id: z.string().uuid().nullable().optional(),
  inquiry_id: z.string().uuid().nullable().optional(),
  note: z.string().max(1000).nullable().optional()
});

export const appointmentStatusSchema = z.object({
  status: z.enum(["accepted", "declined", "cancelled", "completed"])
});

export const markMessagesReadSchema = z.object({
  job_id: z.string().uuid(),
  sender_id: z.string().uuid().optional()
});

export const progressSchema = z.object({
  status: z.enum(["in_progress", "in_review", "delivered", "completed", "closed", "cancelled"]),
  note: z.string().max(2000).nullable().optional()
});

export const verificationReviewSchema = z.object({
  status: z.enum(["verified", "rejected"])
});

export const phoneVerificationStartSchema = z.object({
  phone: z.string().min(7).optional()
});

export const phoneVerificationConfirmSchema = z.object({
  code: z.string().regex(/^\d{6}$/)
});

export const notificationReadSchema = z.object({
  is_read: z.boolean().default(true)
});

export const adminUserStatusSchema = z.object({
  is_active: z.boolean()
});

export const categoryWriteSchema = z.object({
  name: z.string().min(2),
  slug: z.string().min(2),
  icon: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  is_active: z.boolean().default(true),
  sort_order: z.number().int().default(0)
});
