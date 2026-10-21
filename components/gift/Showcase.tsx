"use client";
// For someone without a garden or the party link while planting asks for the link (MEADOW_PLANTING=party; otherwise the
// door offers everyone the seed): Lijas's Enchanted Rose, the garden everyone sees first, with a quiet caption instead
// of an error (copy.ts SHOWCASE_LINE), and a reminder that a personal garden link opens their own garden here. The caption lets every touch through to the
// garden, so it can still be turned and zoomed. Its title is a second-level heading: the page's own heading is the
// hidden introduction (app/seo.tsx).
import { SHOWCASE_LINE } from "@/components/gift/copy";
import { Sparkle } from "@/components/gift/icons";

export function Showcase() {
  return (
    <section className="gift-showcase" aria-label="The garden">
      <p className="gift-eyebrow">
        <Sparkle size={16} />
        In full bloom
      </p>
      <h2 className="gift-title">The Enchanted Rose</h2>
      <p className="gift-showcase-line">{SHOWCASE_LINE}</p>
      <p className="gift-showcase-note">Planted a seed already? Open your personal garden link on this device to see your flower.</p>
    </section>
  );
}
