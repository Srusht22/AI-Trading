import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { Button, EmptyState } from '@/components/ui';
import { PageHeader } from '@/components/layout/PageHeader';

export default function NotFoundPage() {
  return (
    <>
      <PageHeader title="Page not found" description="This address does not match any page in TradePilot." className="sr-only" />
      <EmptyState
        size="lg"
        icon={Compass}
        title="We couldn’t find that page"
        description="The link may be mistyped or the page may belong to a later phase. Use the navigation or go back to the dashboard."
        actions={
          <Button asChild variant="primary">
            <Link to="/">Back to Dashboard</Link>
          </Button>
        }
      />
    </>
  );
}
