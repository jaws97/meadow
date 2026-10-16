// The garden is the whole app. The root forwards to it via the redirect in
// next.config.ts, so this page only exists as a static fallback.
import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-full items-center justify-center bg-[#06080f] text-white/70">
      <Link href="/garden" className="underline underline-offset-4">
        Enter the garden
      </Link>
    </main>
  );
}
