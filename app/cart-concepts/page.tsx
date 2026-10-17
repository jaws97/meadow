// /cart-concepts: the three Lantern Cart concepts side by side on turntables, at golden hour and at dusk, with the
// cart as built beside them (components/meadow/concepts, components/meadow/FireflyTrolley.tsx). A development tool
// only: in a production build the page is not found, so it never reaches colleagues. A default export because that
// is what the page convention requires.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CartConcepts } from "@/components/meadow/concepts/CartConcepts";

export const metadata: Metadata = {
  title: "Lantern Cart concepts - Disney Garden",
  robots: { index: false },
};

export default function CartConceptsPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <CartConcepts />;
}
