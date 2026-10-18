"use client";
// The panel's live part: how many seeds have been planted, and the newest
// names gliding in ("Priya planted a Night Jasmine", "Asha planted a Lotus"),
// each with a dot in its flower's colour (logic.ts seedColour), fed by the
// Meadow snapshot (meadowFeed.ts). New plantings wait in a short line and arrive one
// at a time, a couple of seconds apart, and the counter ticks up with each
// arrival, so a rush at the start of the party reads as a gentle stream
// rather than a jump; in a real crowd the line skips ahead (logic.ts
// FEED_QUEUE_MAX) instead of falling minutes behind. Three names show, the
// older ones dimming as they move down; a fourth fades out below.
//
// When the screen first opens it shows the latest plantings as they are,
// without a glide, so a reload mid-party never leaves the panel empty.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  counterNumber,
  counterWords,
  enqueue,
  FIRST_SEED_LINE,
  latestPlantings,
  newPlantings,
  plantingKey,
  seedColour,
  seedPhrase,
  type Planting,
} from "@/components/party/logic";
import { pollMeadow } from "@/components/party/meadowFeed";

/** Names on show, plus one fading out below them. */
const ROWS = 3;
/** Milliseconds between arrivals, and the counter's tick from one number to the next. */
const ARRIVAL_MS = 2600;
const TICK_MS = 1400;

interface Row extends Planting {
  fresh: boolean;
}

/** Eases a number toward its target over `ms`, on animation frames (at once for reduced motion). */
function useEased(target: number, ms: number): number {
  const [value, setValue] = useState(target);
  const current = useRef(target);
  useEffect(() => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const from = current.current;
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = reduced ? 1 : Math.min(1, (now - start) / ms);
      const v = from + (target - from) * (1 - (1 - t) ** 3);
      current.current = v;
      setValue(v);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return Math.round(value);
}

export function SeedFeed() {
  const [count, setCount] = useState<number | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const known = useRef(new Set<string>());
  const waiting = useRef<Planting[]>([]);
  const total = useRef(0);
  const primed = useRef(false);

  useEffect(() => {
    const stop = pollMeadow((snapshot) => {
      total.current = snapshot.count;
      if (!primed.current) {
        primed.current = true;
        for (const p of snapshot.plots) known.current.add(plantingKey(p));
        setRows(latestPlantings(snapshot.plots, ROWS).map((p) => ({ ...p, fresh: false })));
        setCount(snapshot.count);
        return;
      }
      const fresh = newPlantings(known.current, snapshot.plots);
      for (const p of fresh) known.current.add(p.key);
      enqueue(waiting.current, fresh);
      // the ones still waiting are counted as they arrive
      setCount(Math.max(0, snapshot.count - waiting.current.length));
    });
    const arrivals = window.setInterval(() => {
      const next = waiting.current.shift();
      if (!next) return;
      setRows((list) => [{ ...next, fresh: true }, ...list].slice(0, ROWS + 1));
      setCount(Math.max(0, total.current - waiting.current.length));
    }, ARRIVAL_MS);
    return () => {
      stop();
      window.clearInterval(arrivals);
    };
  }, []);

  const shown = useEased(count ?? 0, TICK_MS);

  return (
    <div className="party-tally">
      {count === null ? null : count === 0 ? (
        <p className="party-count party-count-first">{FIRST_SEED_LINE}</p>
      ) : (
        <p className="party-count">
          <span className="party-count-n">{counterNumber(shown)}</span>
          <span className="party-count-words">{counterWords(shown)}</span>
        </p>
      )}
      <ul className="party-feed">
        {rows.map((row, i) => (
          <li
            key={row.key}
            className={`party-feed-item${row.fresh ? " party-feed-in" : ""}`}
            data-row={i}
            style={{ "--seed": seedColour(row.species) } as CSSProperties}
          >
            <span className="party-feed-dot" aria-hidden="true" />
            <span className="party-feed-name">{row.name}</span>
            <span className="party-feed-rest">planted {seedPhrase(row.species)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
