import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { MailCheck, UserPlus } from 'lucide-react';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { FormAlert } from '@/components/auth/FormAlert';
import { PasswordInput } from '@/components/auth/PasswordInput';
import { emailSchema, firstIssue, newPasswordSchema } from '@/components/auth/validation';
import { Button, EmptyState, FormField, Input, Skeleton } from '@/components/ui';
import { displayNameSchema } from '@/domain/profile';
import { useAuth } from '@/lib/auth/AuthProvider';
import { useServices } from '@/lib/services-context';
import { toAppError, type AppError } from '@/lib/errors';

export default function SignUpPage() {
  const { auth } = useServices();
  const { state } = useAuth();
  const registration = useQuery({ queryKey: ['registration-status'], queryFn: () => auth.getRegistrationStatus(), staleTime: 60_000 });
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; email?: string; password?: string }>({});
  const [error, setError] = useState<AppError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  if (state.status === 'signed_in') return <Navigate to="/" replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = {
      name: name.trim() ? firstIssue(displayNameSchema.safeParse(name)) : undefined,
      email: firstIssue(emailSchema.safeParse(email)),
      password: firstIssue(newPasswordSchema.safeParse(password)),
    };
    setFieldErrors(errs);
    if (errs.name || errs.email || errs.password) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await auth.signUp(email, password, name.trim() || undefined);
      if (result.needsEmailConfirmation) setSentTo(email.trim());
    } catch (err) {
      setError(toAppError(err, 'create your account'));
    } finally {
      setSubmitting(false);
    }
  };

  const footer = (
    <>
      Already have an account?{' '}
      <Link to="/sign-in" className="text-accent font-medium hover:underline">
        Sign in
      </Link>
    </>
  );

  if (sentTo) {
    return (
      <AuthLayout title="Check your email" footer={footer}>
        <EmptyState
          className="px-0 py-4"
          icon={MailCheck}
          title="Confirm your email address"
          description={
            <>
              If <span className="text-fg">{sentTo}</span> can be registered, we’ve sent a confirmation link to it. Open the link in
              this browser to activate your account.
            </>
          }
        />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Create your account"
      description="Accounts are personal. A newly registered account has no access to the workspace until the owner is configured."
      footer={footer}
    >
      {registration.isPending ? (
        <div className="space-y-4" aria-label="Checking whether registration is open" role="status">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : registration.isError ? (
        <FormAlert error={toAppError(registration.error, 'check whether registration is open')} />
      ) : !registration.data.signupEnabled ? (
        <FormAlert info="New registrations are closed for this TradePilot workspace. If you already have an account, sign in instead." />
      ) : (
        <form onSubmit={submit} noValidate className="space-y-5">
          <FormAlert error={error} />
          <FormField label="Display name" optional error={fieldErrors.name} hint="How TradePilot greets you. You can change it later.">
            <Input autoComplete="nickname" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </FormField>
          <FormField label="Email" error={fieldErrors.email}>
            <Input type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </FormField>
          <FormField label="Password" error={fieldErrors.password} hint="At least 10 characters, with upper- and lower-case letters and a number.">
            <PasswordInput autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </FormField>
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={submitting} leadingIcon={<UserPlus />}>
            {submitting ? 'Creating account…' : 'Create account'}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
