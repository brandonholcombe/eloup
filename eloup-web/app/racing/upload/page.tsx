import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth, signIn } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { listTracks } from '@/lib/db/rc';
import { canUploadRaceResults } from '@/lib/permissions';
import { RcUploadForm } from '@/components/RcUploadForm';

export const dynamic = 'force-dynamic';

export default async function RacingUploadPage() {
  const session = await auth();
  if (!session?.user) {
    return (
      <main className="p-4">
        <h1 className="text-2xl font-semibold">Upload race</h1>
        <p className="mt-4 text-sm text-slate-300">Sign in to upload Lap Monitor JSON or TXT.</p>
        <form
          className="mt-4"
          action={async () => {
            'use server';
            await signIn('discord', { redirectTo: '/racing/upload' });
          }}
        >
          <button
            type="submit"
            className="h-tap min-w-tap rounded-md bg-blue-500 px-4 py-2 text-sm font-medium text-white"
          >
            Sign in with Discord
          </button>
        </form>
      </main>
    );
  }
  if (!canUploadRaceResults({ id: session.user.id, role: session.user.role })) {
    redirect('/racing');
  }
  const tracks = listTracks(db());
  return (
    <main className="p-4">
      <Link href="/racing" className="text-sm text-slate-400 hover:text-slate-200">
        ← All races
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Upload race</h1>
      <p className="mt-1 text-sm text-slate-400">
        Paste or upload the Lap Monitor JSON or TXT export. Pick an existing track or create a new
        one. Re-uploading a file that has already been imported is safe — JSON dedupes on the
        race UUID, TXT on a content-hash of the file.
      </p>
      <RcUploadForm tracks={tracks} />
    </main>
  );
}
