/**
 * Database types for the `public` schema, matching
 * supabase/migrations/20261023120000_foundation.sql.
 *
 * Regenerate after schema changes with:  npm run db:types
 * (requires the local Supabase stack). Hand edits must mirror the migration.
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: { id: string; display_name: string | null; created_at: string; updated_at: string };
        Insert: { id: string; display_name?: string | null };
        Update: { display_name?: string | null };
        Relationships: [];
      };
      user_settings: {
        Row: {
          user_id: string;
          theme: string;
          display_currency: string;
          timezone: string;
          date_format: string;
          number_format: string;
          show_beginner_help: boolean;
          notification_preferences: Json;
          revision: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          theme?: string;
          display_currency?: string;
          timezone?: string;
          date_format?: string;
          number_format?: string;
          show_beginner_help?: boolean;
          notification_preferences?: Json;
        };
        Update: {
          theme?: string;
          display_currency?: string;
          timezone?: string;
          date_format?: string;
          number_format?: string;
          show_beginner_help?: boolean;
          notification_preferences?: Json;
        };
        Relationships: [];
      };
      audit_events: {
        Row: {
          id: string;
          actor_user_id: string | null;
          event_type: string;
          resource_type: string;
          resource_id: string | null;
          metadata: Json;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: {
      get_my_access: { Args: Record<never, never>; Returns: { is_owner: boolean; owner_configured: boolean }[] };
      is_owner: { Args: Record<never, never>; Returns: boolean };
      admin_assign_owner: { Args: { p_email: string; p_replace?: boolean }; Returns: string };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
}
