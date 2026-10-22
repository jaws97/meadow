// The welcome page, the site's front door at "/": one page of plain, readable words about Meadow for anyone arriving
// from a search or a shared address, and for search engines, which find no words in the garden's canvas. It says what
// the garden is (a digital garden grown in Bangalore's real weather), what it is for (a flower grown and gifted to
// someone you love), the eight flowers, the city it is a tribute to, its sounds, the shared Meadow and the three steps, in the
// privacy page's calm night and warm inks, and leads to /garden. A device that already holds a garden never sees it:
// the root forwards it to its garden (next.config.ts). Static: no WebGL, no sound, no account. Calm and warm, like the
// garden: no film or company names, no owner's name, no health claims.
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { display } from "@/components/gift/fonts";
import { SEED_PACKETS } from "@/components/gift/species";
import { HOME_DESCRIPTION, HOME_TITLE, SiteData } from "./seo";
import "./welcome.css";

export const metadata: Metadata = {
  title: HOME_TITLE,
  description: HOME_DESCRIPTION,
  alternates: { canonical: "/" },
};

const STEPS = [
  { name: "Plant", words: "Choose one of eight flowers and put a name on its sign. A seed takes a moment." },
  { name: "Care", words: "Open your garden when you can. It tells you when the soil is thirsty, and the weather over Bangalore does the rest." },
  { name: "Gift", words: "When your flower blooms, send its bloom card to someone you love, with a message in your own words." },
];

export default function WelcomePage() {
  return (
    <main className={`welcome ${display.variable}`}>
      <SiteData />

      <section className="welcome-door">
        <div className="welcome-door-art" aria-hidden="true" />
        <div className="welcome-door-words">
          <p className="welcome-eyebrow">A living garden · Bangalore</p>
          <h1 className="welcome-title">
            <span className="welcome-name">Meadow</span>
            <span className="welcome-line">Grow a flower. Gift it to someone you love.</span>
          </h1>
          <div className="welcome-actions">
            <Link href="/garden" className="welcome-cta">
              Enter the garden
            </Link>
            <Link href="/meadow" className="welcome-quiet">
              See everyone&rsquo;s flowers
            </Link>
          </div>
        </div>
      </section>

      <div className="welcome-sheet">
        <section className="welcome-section">
          <h2>A digital garden, grown in real weather</h2>
          <p>
            Meadow is a free digital garden that lives in your browser. You plant one seed, and it grows in the real weather of
            Bangalore: the sun, the clouds and the monsoon rain over the city reach your plot as they happen. With a little
            water and attention your flower comes into bloom in about two weeks, and once its petals have fallen, it blooms
            again.
          </p>
          <p>
            There is nothing to install and no account to make. Your garden lives on a personal link, or on your Google
            account if you prefer.
          </p>
        </section>

        <section className="welcome-section">
          <h2>A gift for someone you love</h2>
          <p>
            When your flower opens, Meadow makes you a bloom card: a photograph of your flower at golden hour, with a message
            in your own words. Send it to someone you love, for an anniversary, a birthday, a thank-you, or for no reason at
            all.
          </p>
          <p>
            A flower you grew yourself over two weeks says what a bought bouquet cannot: that you came back every day. The
            link in the card brings them to your flower, growing in the Meadow.
          </p>
        </section>

        <section className="welcome-section">
          <h2>Eight flowers to choose from</h2>
          <ul className="welcome-flowers">
            {SEED_PACKETS.map((p) => (
              <li key={p.id} className="welcome-flower">
                <Image src={p.image} alt={`${p.name}, as it grows in Meadow`} width={480} height={360} unoptimized />
                <span className="welcome-flower-name">{p.name}</span>
                <span className="welcome-flower-line">{p.tagline}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="welcome-section">
          <h2>A tribute to Bangalore, the Garden City</h2>
          <p>
            Bangalore was the Garden City long before it was anything else: Lalbagh and Cubbon Park, the rain trees arching
            over its roads, jasmine sold by the arm&rsquo;s length at the corner. Meadow is a small tribute to that city.
          </p>
          <p>
            Every flower here grows under its sky. Meadow reads the city&rsquo;s weather hour by hour, so a wet week in
            Bangalore is a wet week in your garden, and a bright October morning opens petals in both.
          </p>
        </section>

        <section className="welcome-section">
          <h2>The garden has its own sounds</h2>
          <p>
            In your own garden you can turn on the sounds of the place: light rain or the full monsoon on a veranda roof, far
            thunder, a garden stream, a courtyard fountain, crickets and rain frogs after dark, a koel and a red-whiskered
            bulbul calling at dawn as they do across Bangalore, wind chimes, a singing bowl, a veena, a kalimba. Mix a few
            together and leave them playing while you work, or while your flower grows.
          </p>
        </section>

        <section className="welcome-section">
          <h2>A shared garden</h2>
          <p>
            Everyone&rsquo;s flowers grow together in the Meadow, in rings round the Enchanted Rose. Ride the lantern cart
            along the paths, find a friend by name, visit their flower and leave it a sprinkle. Some days a deer wanders in
            to look.
          </p>
        </section>

        <section className="welcome-section">
          <h2>How it works</h2>
          <ol className="welcome-steps">
            {STEPS.map((s) => (
              <li key={s.name} className="welcome-step">
                <strong>{s.name}</strong>
                <span>{s.words}</span>
              </li>
            ))}
          </ol>
        </section>

        <div className="welcome-close">
          <p>Your seed is waiting.</p>
          <Link href="/garden" className="welcome-cta">
            Plant your seed
          </Link>
        </div>

        <footer className="welcome-foot">
          <Link href="/privacy">Privacy</Link>
          <span>Made in Bangalore · October 2026</span>
        </footer>
      </div>
    </main>
  );
}
