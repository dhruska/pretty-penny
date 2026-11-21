import { api } from '@/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { safeNext } from '@/lib/signIn';
import { PennyMark } from '@/components/PennyMark';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';

export function LoginPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const next = safeNext(useSearchParams()[0].get('next'));
  const [password, setPassword] = useState('');
  const session = useQuery({ queryKey: ['session'], queryFn: api.session });

  const signIn = useMutation({
    mutationFn: () => api.login(password),
    onSuccess: async () => {
      // Nothing cached from before signing in carries over.
      queryClient.clear();
      navigate(next, { replace: true });
    },
    onError: () => setPassword(''),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (password !== '') signIn.mutate();
  }

  if (session.data?.signedIn) return <Navigate to={next} replace />;

  return (
    <main className="flex min-h-svh items-start justify-center bg-background px-4 pt-[15svh]">
      <form
        aria-label="Sign in"
        onSubmit={submit}
        className="w-full max-w-sm space-y-4 rounded-lg border bg-card p-6 shadow-sm"
      >
        <div className="flex items-center gap-3">
          <PennyMark className="size-10" />
          <div>
            <h1 className="text-xl font-bold tracking-tight">Pretty Penny</h1>
            <p className="text-sm text-muted-foreground">Sign in to your budget.</p>
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        {signIn.isError && (
          <p role="alert" className="text-sm text-negative">
            {signIn.error.message}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={signIn.isPending || password === ''}>
          {signIn.isPending ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </main>
  );
}
