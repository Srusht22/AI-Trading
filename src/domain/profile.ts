import { z } from 'zod';

// Mirrors the profiles.display_name CHECK constraint.
export const displayNameSchema = z
  .string()
  .transform((s) => s.trim())
  .pipe(
    z
      .string()
      .min(1, 'Enter a display name, or clear the field to remove it.')
      .max(80, 'Use 80 characters or fewer.')
      .refine((s) => !/\p{Cc}/u.test(s), 'Remove invisible control characters.'),
  );

export const profileSchema = z.object({
  id: z.string().uuid(),
  display_name: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type Profile = z.infer<typeof profileSchema>;

export const PROFILE_COLUMNS = 'id, display_name, created_at, updated_at';
