import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { FormAlert } from '@/components/auth/FormAlert';
import { PasswordInput } from '@/components/auth/PasswordInput';
import { firstIssue, newPasswordSchema } from '@/components/auth/validation';
import { Button, FormField, PageSkeleton } from '@/components/ui';
import { useAuth } from '@/lib/auth/AuthProvider';
import { useServices } from '@/lib/services-context';
import { AppError, toAppError } from '@/lib/errors';

/**
 * Target of the emailed recovery link. supabase-js exchanges the one-time
 * code in the URL for a short-lived recovery session before this renders.
 */
export default function ResetPasswordPage() {
  const { auth } = useServices();
  const { state, finishRecovery, signOut } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ password?: string; confirm?: string }>({});
  const [error, setError] = useState<AppError | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const back = (
    <Link to="/forgot-password" className="text-accent font-medium hover:underline">
      Request a new link
    </Link>
  );

  if (state.status === 'loading') return <PageSkeleton />;

  const linkError = params.get('error_description') ?? params.get('error');
  if (state.status !== 'signed_in') {
    return (
      <AuthLayout title="Reset link not valid" footer={back}>
        <FormAlert
          error={
            new AppError(
              'auth',
              linkError
                ? 'This reset link has expired or has already been used. Request a new one.'
                : 'Open the password reset link from your email in this browser to continue.',
            )
          }
        />
      </AuthLayout>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = {
      password: firstIssue(newPasswordSchema.safeParse(password)),
      confirm: password === confirm ? undefined : 'The passwords don’t match.',
    };
    setFieldErrors(errs);
    if (errs.password || errs.confirm) return;
    setSubmitting(true);
    setError(null);
    try {
      await auth.updatePassword(password);
      finishRecovery();
      // End the recovery session so the new password is used for the next sign-in.
      await signOut();
      navigate('/sign-in?reset=1', { replace: true });
    } catch (err) {
      setError(toAppError(err, 'update your password'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout title="Choose a new password" description={`For ${state.session.user.email ?? 'your account'}.`} footer={back}>
      <form onSubmit={submit} noValidate className="space-y-5">
        <FormAlert error={error} />
        <FormField label="New password" error={fieldErrors.password} hint="At least 10 characters, with upper- and lower-case letters and a number.">
          <PasswordInput autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        </FormField>
        <FormField label="Confirm new password" error={fieldErrors.confirm}>
          <PasswordInput autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </FormField>
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={submitting} leadingIcon={<KeyRound />}>
          {submitting ? 'Saving…' : 'Save new password'}
        </Button>
      </form>
    </AuthLayout>
  );
}
