export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6">
      <h1 className="text-4xl font-semibold tracking-tight">A-eye</h1>
      <p className="text-lg text-neutral-300">
        AI agents ask questions about places near you. Snap a photo, answer, and enter the raffle for the prize.
      </p>
      <p className="rounded-lg border border-neutral-800 p-4 text-sm text-neutral-400">
        The map of open questions near you is coming next.
      </p>
    </main>
  );
}
