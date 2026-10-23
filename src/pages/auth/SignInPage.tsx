import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { LogIn } from 'lucide-react';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { FormAlert } from '@/components/auth/FormAlert';
import { PasswordInput } from '@/components/auth/PasswordInput';
import { emailSchema, firstIssue } from '@/components/auth/validation';
import { Button, FormField, Input } from '@/components/ui';
import { safeNextPath, useAuth } from '@/lib/auth/AuthProvider';
import { useServices } from '@/lib/services-context';
import { toAppError, type AppError } from '@/lib/errors';

export default function SignInPage() {
  const { auth } = useServices();
  const { state } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNextPath(params.get('next'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [error, setError] = useState<AppError | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (state.status === 'signed_in' && !state.recovery) return <Navigate to={next} replace />;

  const notice =
    state.status === 'signed_out' && state.reason === 'expired'
      ? 'Your session expired. Please sign in again.'
      : params.get('confirmed')
        ? 'Your email is confirmed. You can now sign in.'
        : params.get('reset')
          ? 'Your password was updated. Sign in with your new password.'
          : undefined;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = { email: firstIssue(emailSchema.safeParse(email)), password: password ? undefined : 'Enter your password.' };
    setFieldErrors(errs);
    if (errs.email || errs.password) return;
    setSubmitting(true);
    setError(null);
    try {
      await auth.signIn(email, password);
      navigate(next, { replace: true });
    } catch (err) {
      setError(toAppError(err, 'sign in'));
      setPassword('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      title="Sign in"
      description="Welcome back to your TradePilot research workspace."
      footer={
        <>
          New to TradePilot?{' '}
          <Link to="/sign-up" className="text-accent font-medium hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="space-y-5">
        <FormAlert info={notice} />
        <FormAlert error={error} />
        <FormField label="Email" error={fieldErrors.email}>
          <Input type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </FormField>
        <FormField
          label="Password"
          error={fieldErrors.password}
          labelAddon={
            <Link to="/forgot-password" className="text-fg-3 hover:text-fg ml-auto text-xs font-medium">
              Forgot password?
            </Link>
          }
        >
          <PasswordInput autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </FormField>
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={submitting} leadingIcon={<LogIn />}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </AuthLayout>
  );
}
