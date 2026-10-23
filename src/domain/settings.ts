import { z } from 'zod';

/**
 * User display preferences. Allowed values mirror the CHECK constraints in
 * supabase/migrations/20261023120000_foundation.sql — keep both in sync.
 */
export const THEMES = ['dark', 'light'] as const;
export const DISPLAY_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'AUD', 'CAD', 'NZD'] as const;
export const DATE_FORMATS = ['medium', 'iso', 'dmy', 'mdy'] as const;
export const NUMBER_FORMATS = ['en-US', 'en-GB', 'de-DE', 'fr-FR'] as const;

export type Theme = (typeof THEMES)[number];
export type DisplayCurrency = (typeof DISPLAY_CURRENCIES)[number];
export type DateFormat = (typeof DATE_FORMATS)[number];
export type NumberFormat = (typeof NUMBER_FORMATS)[number];

export const notificationPreferencesSchema = z
  .object({
    backtests: z.boolean(),
    connection: z.boolean(),
    approvals: z.boolean(),
    research: z.boolean(),
  })
  .strict();

export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Fields a user may edit. Ownership, revision and timestamps are server-controlled. */
export const settingsPatchSchema = z
  .object({
    theme: z.enum(THEMES),
    display_currency: z.enum(DISPLAY_CURRENCIES),
    timezone: z.string().min(1).max(64).refine(isValidTimeZone, 'Choose a valid timezone.'),
    date_format: z.enum(DATE_FORMATS),
    number_format: z.enum(NUMBER_FORMATS),
    show_beginner_help: z.boolean(),
    notification_preferences: notificationPreferencesSchema,
  })
  .partial()
  .strict();

export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

/** Row as returned by the database. Validated on every read. */
export const userSettingsSchema = z.object({
  user_id: z.string().uuid(),
  theme: z.enum(THEMES),
  display_currency: z.enum(DISPLAY_CURRENCIES),
  timezone: z.string(),
  date_format: z.enum(DATE_FORMATS),
  number_format: z.enum(NUMBER_FORMATS),
  show_beginner_help: z.boolean(),
  notification_preferences: notificationPreferencesSchema,
  revision: z.number().int().positive(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type UserSettings = z.infer<typeof userSettingsSchema>;

export const SETTINGS_COLUMNS =
  'user_id, theme, display_currency, timezone, date_format, number_format, show_beginner_help, notification_preferences, revision, created_at, updated_at';
