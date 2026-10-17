"use client";
// The visit card: who planted this flower, which seed it is, which day of its life, and how it is doing in kind
// words; then what a visitor can do. The flower and the day sit right under the name (and name the card for screen
// readers), so two colleagues with one first name are told apart. A friend's plant offers today's one Sprinkle (POST /api/sprinkle, only for
// someone whose garden is on this device; "1 left today", or the server's own words once it is shared or if it is
// refused) and "See their garden", a read-only look at their whole garden. A person's own plant says "This is
// yours" instead. The owner's rose on the dais has a card of its own.
//
// On a phone the card sits at the bottom of the screen and tells the camera how much it covers, so the plant is
// framed in the part left clear; on a landscape screen it stands to the side. Focus moves into the card when it opens
// (so its name, flower and day are read out), and back to Find a friend when it is closed from inside it.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ROSE } from "@/components/meadow/autopilot";
import { sprinkleAt } from "@/components/meadow/Bursts";
import {
  loadFriend,
  pollNow,
  rememberSprinkle,
  sendSprinkle,
  sprinkledToday,
  useMe,
  useMeadowData,
  type FriendGarden,
} from "@/components/meadow/data";
import { findButton } from "@/components/meadow/FindFriend";
import { CloseIcon, DropIcon, GateIcon, LeafIcon } from "@/components/meadow/icons";
import { OWNER_NAME } from "@/components/meadow/plantLook";
import { meadow } from "@/components/meadow/runtime";
import { ui, useUi } from "@/components/meadow/ui";
import { dayText, moodLine, speciesName } from "@/components/meadow/words";

type SprinkleState =
  | { plot: number; state: "sending" }
  | { plot: number; state: "done"; message: string }
  | { plot: number; state: "refused"; message: string };

function close() {
  // focus in the card would fall to the page with it: Find a friend is the way on
  const inside = document.activeElement?.closest(".meadow-card") != null;
  ui.set({ card: null });
  meadow.requests.cancel = true;
  if (inside) requestAnimationFrame(() => findButton.current?.focus({ preventScroll: true }));
}

export function VisitCard() {
  const card = useUi((s) => s.card);
  const ref = useRef<HTMLDivElement>(null);

  // tell the camera how much of the screen the card covers: the bottom on a phone, the right side on a wide screen
  useLayoutEffect(() => {
    const el = ref.current;
    const clear = () => {
      meadow.view.cover = 0;
      meadow.view.coverSide = 0;
    };
    if (!el || card === null) {
      clear();
      return;
    }
    const measure = () => {
      const r = el.getBoundingClientRect();
      // a card standing on the right near the top is the landscape layout; anything else sits along the bottom
      const atBottom = !(r.left > window.innerWidth * 0.45 && r.top < window.innerHeight * 0.3);
      meadow.view.cover = atBottom ? Math.min(0.6, (window.innerHeight - r.top + 16) / window.innerHeight) : 0;
      meadow.view.coverSide = atBottom ? 0 : Math.min(0.5, (window.innerWidth - r.left + 16) / window.innerWidth);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
      clear();
    };
  }, [card]);

  // focus moves in as the card opens (or turns to another plant); Escape closes it
  useEffect(() => {
    if (card === null) return;
    ref.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [card]);

  if (card === null) return null;
  return (
    <div className="meadow-card-dock">
      <div ref={ref} key={card} className="meadow-card meadow-glass" role="dialog" aria-labelledby="meadow-card-name meadow-card-sub" tabIndex={-1}>
        <button type="button" className="meadow-close" onClick={close} aria-label="Close">
          <CloseIcon />
        </button>
        {card === ROSE ? <RoseCard /> : <PlantCard plot={card} />}
      </div>
    </div>
  );
}

function RoseCard() {
  return (
    <>
      <h2 id="meadow-card-name">{OWNER_NAME}</h2>
      <p id="meadow-card-sub" className="meadow-sub">
        Enchanted Rose · Always in bloom
      </p>
      <p className="meadow-mood">The rose at the heart of the Meadow. Every seed here was a gift from {OWNER_NAME}.</p>
      <div className="meadow-row">
        <a className="meadow-button meadow-button-quiet" href="/meadow/garden?plot=rose">
          <GateIcon /> See their garden
        </a>
      </div>
    </>
  );
}

function PlantCard({ plot }: { plot: number }) {
  const entry = useMeadowData((d) => d.byPlot.get(plot) ?? null);
  const me = useMe();
  const [loaded, setLoaded] = useState<{ plot: number; friend: FriendGarden | null; message: string | null } | null>(null);
  const [sprinkle, setSprinkle] = useState<SprinkleState | null>(null);
  const info = loaded && loaded.plot === plot ? loaded : null;
  const friend = info?.friend ?? null;
  const shared = sprinkle && sprinkle.plot === plot ? sprinkle : null;

  useEffect(() => {
    let live = true;
    void loadFriend(plot).then((r) => {
      if (!live) return;
      setLoaded(r.ok ? { plot, friend: r.value, message: null } : { plot, friend: null, message: r.message });
    });
    return () => {
      live = false;
    };
  }, [plot]);

  // the plant has gone (a practice plant cleared away): nothing to show
  useEffect(() => {
    if (entry === null && info && !info.friend) ui.set({ card: null });
  }, [entry, info]);

  const name = friend?.name ?? entry?.name ?? "A friend";
  const species = friend?.species ?? entry?.species;
  const sub = [species ? speciesName(species) : null, friend ? dayText(friend.day) : null].filter(Boolean).join(" · ");
  const mood = friend ? moodLine(friend) : (info?.message ?? "Taking a closer look.");
  const mine = me?.signedIn && me.plot === plot;

  const onSprinkle = async () => {
    setSprinkle({ plot, state: "sending" });
    const r = await sendSprinkle(plot);
    if (r.ok) {
      rememberSprinkle();
      sprinkleAt(plot);
      setSprinkle({ plot, state: "done", message: r.message });
      pollNow();
    } else {
      if (r.code === "sprinkled_today") rememberSprinkle();
      setSprinkle({ plot, state: "refused", message: r.message });
    }
  };

  return (
    <>
      <h2 id="meadow-card-name">{name}</h2>
      {sub && (
        <p id="meadow-card-sub" className="meadow-sub">
          {sub}
        </p>
      )}
      <p className="meadow-mood">{mood}</p>
      <div className="meadow-row">
        {me === null ? null : mine ? (
          <>
            <span className="meadow-note meadow-note-warm">This is yours.</span>
            <a className="meadow-button meadow-button-quiet" href="/garden">
              <LeafIcon /> Tend it in your garden
            </a>
          </>
        ) : me.signedIn ? (
          <SprinkleControl state={shared} onSprinkle={onSprinkle} />
        ) : (
          <span className="meadow-note">Sprinkles are shared from your own garden. Open your garden on this device to share one.</span>
        )}
      </div>
      {!mine && (
        <div className="meadow-row">
          <a className="meadow-button meadow-button-quiet" href={`/meadow/garden?plot=${plot}`}>
            <GateIcon /> See their garden
          </a>
        </div>
      )}
    </>
  );
}

function SprinkleControl({ state, onSprinkle }: { state: SprinkleState | null; onSprinkle: () => void }) {
  if (state?.state === "done" || state?.state === "refused") {
    return <span className="meadow-note meadow-note-warm">{state.message}</span>;
  }
  const already = sprinkledToday();
  return (
    <>
      <button type="button" className="meadow-button meadow-button-primary" onClick={onSprinkle} disabled={state?.state === "sending" || already}>
        <DropIcon /> {state?.state === "sending" ? "Sprinkling" : "Sprinkle"}
      </button>
      <span className="meadow-note">{already ? "Today's sprinkle is shared. Tomorrow brings another." : "1 left today"}</span>
    </>
  );
}
