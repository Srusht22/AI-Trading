/** Every key is scoped by user id so cached data can never cross accounts. */
export const queryKeys = {
  access: (uid: string) => ['access', uid] as const,
  profile: (uid: string) => ['profile', uid] as const,
  settings: (uid: string) => ['settings', uid] as const,
  audit: (uid: string) => ['audit', uid] as const,
  auditRecent: (uid: string, limit: number) => ['audit', uid, 'recent', limit] as const,
  auditActivity: (uid: string, days: number) => ['audit', uid, 'activity', days] as const,
};
