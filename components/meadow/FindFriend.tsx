"use client";
// "Find a friend": type a first name, pick them from the Meadow's names (from the snapshot, so no extra request),
// and a golden firefly trail lights the way along the paths while the cart drives there (Fireflies.tsx); the card
// opens when the cart pulls up. A pill at the top names who the fireflies are leading to, with "Skip" to go straight
// there. People who keep their name private show as "A friend" and are not searchable by name. With the person's
// own garden on this device, their flower is the first suggestion.
import { useEffect, useMemo, useRef, useState } from "react";
import { useMe, useMeadowData, type MeadowPlot } from "@/components/meadow/data";
import { CloseIcon, SearchIcon, SparkleIcon } from "@/components/meadow/icons";
import { meadow } from "@/components/meadow/runtime";
import { ui, useUi } from "@/components/meadow/ui";
import { speciesName, stageWord } from "@/components/meadow/words";
import { SPECIES } from "@/lib/plant/species";

const MAX_RESULTS = 8;

/** Lower case without accents, so "Zoë" is found by "zoe". */
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase().trim();

export function startJourney(p: Pick<MeadowPlot, "plot" | "name">, name?: string) {
  ui.set({ findOpen: false, card: null, journey: { index: p.plot, name: name ?? p.name } });
  meadow.requests.visit = { index: p.plot, journey: true };
}

export function FindFriend() {
  const open = useUi((s) => s.findOpen);
  if (!open) return null;
  return <FindPanel />;
}

function FindPanel() {
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const byPlot = useMeadowData((d) => d.byPlot);
  const me = useMe();
  const mine = me?.signedIn && me.plot !== null ? byPlot.get(me.plot) ?? null : null;

  useEffect(() => {
    input.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") ui.set({ findOpen: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const results = useMemo(() => {
    const q = fold(query);
    if (!q) return [];
    const starts: MeadowPlot[] = [];
    const contains: MeadowPlot[] = [];
    for (const p of byPlot.values()) {
      if (p.name === "A friend") continue;
      const n = fold(p.name);
      if (n.startsWith(q)) starts.push(p);
      else if (n.includes(q)) contains.push(p);
    }
    const byName = (a: MeadowPlot, b: MeadowPlot) => a.name.localeCompare(b.name) || a.plot - b.plot;
    return [...starts.sort(byName), ...contains.sort(byName)].slice(0, MAX_RESULTS);
  }, [query, byPlot]);

  const row = (p: MeadowPlot, label?: string) => (
    <button key={p.plot} type="button" className="meadow-result" onClick={() => startJourney(p, label ? "your flower" : undefined)}>
      <span className="meadow-swatch" style={{ background: `radial-gradient(circle at 40% 35%, ${SPECIES[p.species].flower.colorTip}, ${SPECIES[p.species].flower.colorMid} 55%, ${SPECIES[p.species].flower.colorBase})` }} />
      <span>
        <strong>{label ?? p.name}</strong>
        <span>
          {speciesName(p.species)}, {stageWord(p)}
        </span>
      </span>
    </button>
  );

  return (
    <div className="meadow-find-dock" onPointerDown={(e) => e.target === e.currentTarget && ui.set({ findOpen: false })}>
      <div className="meadow-find meadow-glass" role="dialog" aria-label="Find a friend">
        <header>
          <h2>Find a friend</h2>
          <button type="button" className="meadow-close" style={{ position: "static" }} onClick={() => ui.set({ findOpen: false })} aria-label="Close">
            <CloseIcon />
          </button>
        </header>
        <input
          ref={input}
          className="meadow-search"
          type="search"
          inputMode="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Type a first name"
          aria-label="First name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && results[0]) startJourney(results[0]);
          }}
        />
        <div className="meadow-results">
          {query.trim() === "" ? (
            <>
              {mine && row(mine, "Your flower")}
              <p className="meadow-empty">
                <SparkleIcon size={14} style={{ display: "inline", verticalAlign: "-2px", marginRight: 6, color: "var(--m-gold)" }} />
                Fireflies will light the way along the paths.
              </p>
            </>
          ) : results.length > 0 ? (
            results.map((p) => row(p))
          ) : (
            <p className="meadow-empty">No one by that name has planted yet. Names in the Meadow are first names, as their owners typed them.</p>
          )}
        </div>
      </div>
    </div>
  );
}

/** The pill at the top while the fireflies lead the way: who to, "Skip" to go straight there, and stop. */
export function JourneyPill() {
  const journey = useUi((s) => s.journey);
  if (!journey) return null;
  const who = journey.name === "your flower" ? "your flower" : journey.name;
  return (
    <div className="meadow-journey meadow-glass" role="status" aria-live="polite">
      <span>Fireflies are lighting the way to {who}</span>
      <button type="button" className="meadow-pill meadow-pill-gold" onClick={() => (meadow.requests.teleport = true)}>
        Skip
      </button>
      <button
        type="button"
        className="meadow-close"
        style={{ position: "static", width: 34, height: 34 }}
        aria-label="Stop"
        onClick={() => {
          ui.set({ journey: null });
          meadow.requests.cancel = true;
        }}
      >
        <CloseIcon size={16} />
      </button>
    </div>
  );
}

export function FindButton() {
  return (
    <button type="button" className="meadow-pill meadow-glass" onClick={() => ui.set({ findOpen: true })}>
      <SearchIcon /> Find a friend
    </button>
  );
}
