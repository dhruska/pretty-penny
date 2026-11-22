import { SkeletonRows } from '@/components/ui/skeleton';
import { openPlaidLink, readPendingLink } from '@/lib/plaidLink';
import { finishLink, useLinkOutcome } from '@/lib/useBankLink';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';

/**
 * Where banks that sign you in on their own site send you back. It resumes
 * Plaid's sign-in window where it left off, then returns to Bank connections.
 */
export function BankOAuthPage() {
  const navigate = useNavigate();
  // What Plaid's window was doing before the bank's site, remembered on this device.
  const [pending] = useState(readPendingLink);
  const [error, setError] = useState<string | null>(
    pending ? null : 'This bank sign-in has expired or was already finished.',
  );
  const started = useRef(false);
  const handleOutcome = useLinkOutcome((connection) =>
    navigate('/bank', { replace: true, state: { linkConnectionId: connection.id } }),
  );

  useEffect(() => {
    // Development mode runs effects twice; Plaid's window must only open once.
    if (!pending || started.current) return;
    started.current = true;
    openPlaidLink(pending.token, window.location.href)
      .then((result) => finishLink(pending, result))
      .then((outcome) => {
        handleOutcome(outcome);
        if (outcome?.kind !== 'connected') navigate('/bank', { replace: true });
      })
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : 'The bank sign-in didn’t finish.'),
      );
  }, [pending, handleOutcome, navigate]);

  if (error) {
    return (
      <div className="space-y-3">
        <h2 className="text-2xl font-semibold">Bank sign-in</h2>
        <p role="alert" className="text-negative">
          {error}
        </p>
        <Link to="/bank" className="text-sm font-medium text-accent-ink underline">
          Back to Bank connections
        </Link>
      </div>
    );
  }
  return <SkeletonRows rows={3} label="Finishing the bank sign-in" />;
}
