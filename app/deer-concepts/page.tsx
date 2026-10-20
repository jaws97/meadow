// /deer-concepts: a chital doe, built in code, visiting the owner's flower garden, for sign-off before anything is
// built into the product (components/deer). A development tool only: in a production build the page is not found,
// so it never reaches colleagues (notFound() is called in the render path, as Next 16.4's notFound reference asks).
// A default export because that is what the page convention requires.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DeerConcepts } from "@/components/deer/DeerConcepts";

export const metadata: Metadata = {
  title: "Deer concepts - Meadow",
  robots: { index: false },
};

export default function DeerConceptsPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <DeerConcepts />;
}
