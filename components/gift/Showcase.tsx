"use client";
// For someone with no seed and no party link: Lijas's Enchanted Rose, the garden everyone sees first, with a quiet
// caption instead of an error. What it says follows the season (copy.ts showcaseLine), and it reminds anyone who has
// planted already that their personal garden link opens their own garden here. The caption lets every touch through
// to the garden, so it can still be turned and zoomed.
import { useState } from "react";
import { showcaseLine } from "@/components/gift/copy";
import { Sparkle } from "@/components/gift/icons";

export function Showcase() {
  const [line] = useState(() => showcaseLine());
  return (
    <section className="gift-showcase" aria-label="The garden">
      <p className="gift-eyebrow">
        <Sparkle size={16} />
        In full bloom
      </p>
      <h1 className="gift-title">The Enchanted Rose</h1>
      <p className="gift-showcase-line">{line}</p>
      <p className="gift-showcase-note">Planted a seed already? Open your personal garden link on this device to see your flower.</p>
    </section>
  );
}
