import { z } from "zod";

export const profilePatchSchema = z.object({
  first_name: z.string().min(1).optional(),
  last_name: z.string().min(1).optional(),
  phone: z.string().min(7).optional(),
  avatar_url: z.string().url().nullable().optional()
}).strict();

export const professionalProfilePatchSchema = z.object({
  bio: z.string().max(2000).nullable().optional(),
  years_experience: z.number().int().min(0).optional(),
  hourly_rate: z.number().min(0).nullable().optional(),
  location: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  is_available: z.boolean().optional()
}).strict();

export const setCategoriesSchema = z.object({
  category_ids: z.array(z.string().uuid()).min(1)
});

export const createJobSchema = z.object({
  category_id: z.string().uuid(),
  title: z.string().min(5).max(180),
  description: z.string().min(20),
  budget_min: z.number().min(0).nullable().optional(),
  budget_max: z.number().min(0).nullable().optional(),
  budget_type: z.enum(["fixed", "hourly"]).default("fixed"),
  currency: z.string().default("NGN"),
  location: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  is_remote: z.boolean().default(false),
  start_date: z.string().nullable().optional(),
  end_date: z.string().nullable().optional()
});

export const updateJobSchema = createJobSchema.partial().extend({
  payment_note: z.string().nullable().optional()
}).strict();

export const applySchema = z.object({
  pitch: z.string().min(20).max(3000),
  proposed_rate: z.number().min(0).nullable().optional(),
  reference_image_urls: z.array(z.string().max(1_500_000)).max(3).optional()
});

export const applicationPatchSchema = applySchema.partial().strict();

export const awardSchema = z.object({
  agreed_amount: z.number().min(0).nullable().optional()
});

export const messageSchema = z.object({
  receiver_id: z.string().uuid(),
  job_id: z.string().uuid(),
  application_id: z.string().uuid().nullable().optional(),
  body: z.string().min(1).max(3000)
});

export const markMessagesReadSchema = z.object({
  job_id: z.string().uuid(),
  sender_id: z.string().uuid().optional()
});

export const progressSchema = z.object({
  status: z.enum(["in_progress", "in_review", "delivered", "closed", "cancelled"]),
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
