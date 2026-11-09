import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useQuery } from '@tanstack/react-query';

async function fetchHello(): Promise<{ message: string }> {
  const response = await fetch('/api/hello');
  if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
  return response.json();
}

export function HomePage() {
  const hello = useQuery({ queryKey: ['hello'], queryFn: fetchHello, retry: false });

  return (
    <main className="mx-auto max-w-md px-4 py-16">
      <Card>
        <CardHeader>
          <CardTitle>Pretty Penny</CardTitle>
        </CardHeader>
        <CardContent>
          {hello.isPending && <p className="text-muted-foreground">Loading…</p>}
          {hello.isError && <p className="text-negative">Can't reach the server.</p>}
          {hello.isSuccess && <p>{hello.data.message}</p>}
        </CardContent>
      </Card>
    </main>
  );
}
