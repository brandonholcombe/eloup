import { auth } from '@/lib/auth';
import { InstallPrompt } from '@/components/InstallPrompt';

// Server wrapper: reads the session so the install prompt only shows after login.
// Async server component rendered inside the (sync) RootLayout — same pattern as
// BottomNav. Passes a serializable boolean to the client component.
export async function InstallPromptGate() {
  const session = await auth();
  return <InstallPrompt signedIn={!!session?.user} />;
}
