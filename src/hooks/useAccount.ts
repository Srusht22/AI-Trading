import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCurrentUser } from '@/lib/auth/AuthProvider';
import { useServices } from '@/lib/services-context';
import { AppError, isAppError } from '@/lib/errors';
import type { SettingsPatch, UserSettings } from '@/domain/settings';
import { queryKeys } from './queryKeys';

export function useAccess() {
  const { access } = useServices();
  const user = useCurrentUser();
  return useQuery({ queryKey: queryKeys.access(user.id), queryFn: () => access.getMyAccess(), staleTime: 60_000 });
}

export function useProfile() {
  const { profiles } = useServices();
  const user = useCurrentUser();
  return useQuery({ queryKey: queryKeys.profile(user.id), queryFn: () => profiles.ensure(user.id) });
}

export function useUpdateDisplayName() {
  const { profiles } = useServices();
  const user = useCurrentUser();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (displayName: string | null) => profiles.updateDisplayName(user.id, displayName),
    onSuccess: (profile) => {
      qc.setQueryData(queryKeys.profile(user.id), profile);
      void qc.invalidateQueries({ queryKey: queryKeys.audit(user.id) });
    },
  });
}

export function useSettings() {
  const { settings } = useServices();
  const user = useCurrentUser();
  return useQuery({ queryKey: queryKeys.settings(user.id), queryFn: () => settings.ensure(user.id) });
}

/**
 * Persist a settings change. Resolves only after the database confirmed the
 * write; on a revision conflict the latest stored settings are re-fetched.
 */
export function useUpdateSettings() {
  const { settings } = useServices();
  const user = useCurrentUser();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: SettingsPatch) => {
      const current = qc.getQueryData<UserSettings>(queryKeys.settings(user.id));
      if (!current) throw new AppError('not_found', 'Your settings haven’t loaded yet. Please wait a moment and try again.');
      return settings.update(user.id, patch, current.revision);
    },
    onSuccess: (saved) => {
      qc.setQueryData(queryKeys.settings(user.id), saved);
      void qc.invalidateQueries({ queryKey: queryKeys.audit(user.id) });
    },
    onError: (error) => {
      if (isAppError(error) && (error.kind === 'conflict' || error.kind === 'not_found')) {
        void qc.invalidateQueries({ queryKey: queryKeys.settings(user.id) });
      }
    },
  });
}
