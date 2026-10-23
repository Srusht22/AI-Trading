import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Send } from 'lucide-react';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { FormAlert } from '@/components/auth/FormAlert';
import { emailSchema, firstIssue } from '@/components/auth/validation';
import { Button, FormField, Input } from '@/components/ui';
import { useServices } from '@/lib/services-context';
import { toAppError, type AppError } from '@/lib/errors';

export default function ForgotPasswordPage() {
  const { auth } = useServices();
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string>();
  const [error, setError] = useState<AppError | null>(null);
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const issue = firstIssue(emailSchema.safeParse(email));
    setFieldError(issue);
    if (issue) return;
    setSubmitting(true);
    setError(null);
    try {
      await auth.requestPasswordReset(email);
      setSent(true);
    } catch (err) {
      setError(toAppError(err, 'send the reset email'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      title="Reset your password"
      description="Enter the email you signed up with and we’ll send you a link to choose a new password."
      footer={
        <Link to="/sign-in" className="text-accent font-medium hover:underline">
          Back to sign in
        </Link>
      }
    >
      {sent ? (
        // Same message whether or not the account exists, so it cannot be used to discover accounts.
        <FormAlert success="If an account exists for that email, a reset link is on its way. The link works once and expires after a short time." />
      ) : (
        <form onSubmit={submit} noValidate className="space-y-5">
          <FormAlert error={error} />
          <FormField label="Email" error={fieldError}>
            <Input type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          </FormField>
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={submitting} leadingIcon={<Send />}>
            {submitting ? 'Sending…' : 'Send reset link'}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
