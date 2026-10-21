// /privacy: what Meadow keeps about a garden, and what it never keeps, in plain words. Linked from Google sign-in's
// button (components/gift/GoogleButton) and given to Google as the sign-in's privacy page. Calm and short, like the
// garden: no film or company names, no owner's name, no health claims. Static.
import type { Metadata } from "next";
import Link from "next/link";
import { display } from "@/components/gift/fonts";
import "./privacy.css";

export const metadata: Metadata = {
  title: "Privacy · Meadow",
  description: "What Meadow keeps about your garden, and what it never keeps.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <main className={`privacy ${display.variable}`}>
      <article className="privacy-sheet">
        <p className="privacy-eyebrow">Meadow</p>
        <h1 className="privacy-title">What Meadow keeps</h1>
        <p className="privacy-lead">
          Meadow is a garden you grow in the real Bangalore weather. It keeps only what your garden needs to grow, and nothing to
          sell.
        </p>

        <h2 className="privacy-h2">Your garden</h2>
        <ul className="privacy-list">
          <li>The name on your flower&rsquo;s sign: your first name, or &ldquo;A friend&rdquo; if you chose that. Everyone in the Meadow can see it.</li>
          <li>Your flower, how you look after it, and the sprinkles friends leave for it.</li>
          <li>
            A cookie that lets your device open your garden, and the personal garden links you make. We store only scrambled
            forms of them, so they cannot be read back.
          </li>
        </ul>

        <h2 className="privacy-h2">Signing in with Google</h2>
        <p className="privacy-p">
          When you continue with Google, Google tells us only the number it uses for your account. We scramble that number with
          a key of our own before we store it, so it opens your garden and does nothing else.
        </p>
        <p className="privacy-p">
          We never receive your email, your name, your photo or your contacts, and we never see your password.
        </p>

        <h2 className="privacy-h2">What we never do</h2>
        <ul className="privacy-list">
          <li>No ads, and nothing about you is sold or shared.</li>
          <li>No tracking across other sites.</li>
          <li>
            Visits are counted without cookies and without knowing who you are (Vercel Web Analytics), with garden links and
            party codes taken out of every address first.
          </li>
        </ul>

        <h2 className="privacy-h2">Where it lives</h2>
        <p className="privacy-p">Gardens are kept in a database run by Supabase, and the site is served by Vercel.</p>

        <p className="privacy-foot">
          <Link href="/garden">Back to the garden</Link>
          <span>Updated October 2026</span>
        </p>
      </article>
    </main>
  );
}
