import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-[560px] px-4 py-24">
      <h1 className="text-3xl font-semibold tracking-tight">That question isn&apos;t here.</h1>
      <p className="mt-2 text-muted">It may have been removed, or the link is wrong.</p>
      <Link href="/" className="btn btn-ghost mt-6">
        Back to nearby questions
      </Link>
    </main>
  );
}
