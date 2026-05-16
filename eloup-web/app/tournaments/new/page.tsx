import { auth } from '@/lib/auth';
import { NewTournamentForm } from '@/components/NewTournamentForm';

export const dynamic = 'force-dynamic';

export default async function NewTournamentPage() {
  const session = await auth();
  if (!session?.user) return null;
  return (
    <main className="p-4">
      <h1 className="text-2xl font-semibold">New tournament</h1>
      <NewTournamentForm />
    </main>
  );
}
