import { z } from "zod/v4";

export const organizationSchema = z.object({
  name: z.string().min(1, "Nimi vaaditaan"),
  address: z.string().optional(),
  website: z.string().optional(),
  ytunnus: z.string().optional(),
  virallinen_nimi: z.string().optional(),
  henkilokunta: z.string().optional(),
  liikevaihto: z.string().optional(),
  perustettu: z.string().optional(),
  paatoimiala_tol: z.string().optional(),
  paatoimiala_pf: z.string().optional(),
  markkinointinimi: z.string().optional(),
  ownerId: z.string().optional(),
});

export const personSchema = z.object({
  firstName: z.string().min(1, "Etunimi vaaditaan"),
  lastName: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  jobTitle: z.string().optional(),
  organizationId: z.string().optional(),
  ownerId: z.string().optional(),
});

export const dealSchema = z.object({
  title: z.string().min(1, "Nimi vaaditaan"),
  status: z.enum(["OPEN", "WON", "LOST"]).default("OPEN"),
  isLead: z.boolean().default(false),
  value: z.coerce.number().optional(),
  currency: z.string().default("EUR"),
  expectedCloseDate: z.string().optional(),
  lostReason: z.string().optional(),
  probability: z.coerce.number().min(0).max(100).optional(),
  pipelineId: z.string().optional(),
  stageId: z.string().optional(),
  organizationId: z.string().optional(),
  personId: z.string().optional(),
  ownerId: z.string().optional(),
});

export const activitySchema = z.object({
  subject: z.string().min(1, "Aihe vaaditaan"),
  type: z.enum([
    "CALL", "MEETING", "EMAIL", "UNANSWERED_CALL",
    "TASK", "DEADLINE", "LUNCH", "BUUKKAUS", "PERUTTU_PALAVERI",
  ]).default("TASK"),
  done: z.boolean().default(false),
  note: z.string().optional(),
  dueDate: z.string().optional(),
  dueTime: z.string().optional(),
  duration: z.string().optional(),
  location: z.string().optional(),
  assigneeId: z.string().optional(),
  organizationId: z.string().optional(),
  personId: z.string().optional(),
  dealId: z.string().optional(),
});

export const noteSchema = z.object({
  content: z.string().min(1, "Sisältö vaaditaan"),
  organizationId: z.string().optional(),
  personId: z.string().optional(),
  dealId: z.string().optional(),
});

export type OrganizationInput = z.infer<typeof organizationSchema>;
export type PersonInput = z.infer<typeof personSchema>;
export type DealInput = z.infer<typeof dealSchema>;
export type ActivityInput = z.infer<typeof activitySchema>;
export type NoteInput = z.infer<typeof noteSchema>;
