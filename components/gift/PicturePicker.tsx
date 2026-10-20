"use client";
// The Picture row in the name pill's menu (components/gift/IdentityMenu) and, opened under it, the four ways the garden
// can be drawn (lib/garden/picture): Auto, the default, names the tier it picked for this device ("Chosen for this
// phone: Light"); Cinematic, Balanced and Light are a choice made by hand. A tier richer than Auto's carries a warm
// line saying what it may cost ("May run warm on this phone"). The row's right side says what is on now
// ("Auto · Light", or "Cinematic").
//
// A choice is applied to the garden here: the store's tier changes and RenderBudget takes it as a tier picked by hand
// (pinned), built out of sight and swapped in while the garden keeps moving, or, where the browser cannot build it out
// of sight, behind a still of the last frame for a moment. Auto unpins the tier again, back on the tier Auto last drew.
// Until the new tier is on screen the chosen row says "Changing the picture…" over a gold hairline that creeps under
// it; then the change is announced ("Picture: Cinematic").
//
// The choices are a radio group: one tab stop (the chosen one), the arrow keys move between them, and Space or Enter
// picks, so moving through them never sets off a tier change on its way. The row opens closed each time the menu does.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Chevron, Picture } from "@/components/gift/icons";
import {
  above,
  deviceWord,
  picture,
  PICTURE_CHOICES,
  PICTURE_LINE,
  PICTURE_NAME,
  pictureSummary,
  pictureWarning,
  setPictureChoice,
  usePicture,
  type PictureChoice,
} from "@/lib/garden/picture";
import { quality, useQuality } from "@/lib/garden/quality";
import { garden, useGarden } from "@/lib/garden/store";

/** Longest a row says "Changing the picture…": a preparation that gave up leaves the new tier built in place. */
const CHANGING_MAX_MS = 20000;

/** The tier on screen differs from the one asked for while it is prepared, or it is being built behind a still. */
function changing(): boolean {
  const q = quality.get();
  return q.tier !== garden.get().quality || (!q.veiled && q.phase !== "live");
}

/** What the Picture row says is on now: on Auto, what Auto is drawing (the governor may have stepped it). */
function summaryNow(): string {
  const p = picture.get();
  return pictureSummary(p.choice, p.choice === "auto" ? garden.get().quality : p.auto);
}

/** Applies a choice to the garden: the store's tier, pinned by hand or, for Auto, left to the governor again. */
function choose(choice: PictureChoice) {
  setPictureChoice(choice, quality.get().tier);
  const tier = choice === "auto" ? picture.get().auto : choice;
  garden.set({ quality: tier });
  // after the store's subscribers (RenderBudget pins any tier set from outside it)
  quality.set({ pinned: choice !== "auto" });
}

export function PicturePicker() {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<PictureChoice | null>(null);
  const [said, setSaid] = useState("");
  const choice = usePicture((s) => s.choice);
  const savedAuto = usePicture((s) => s.auto);
  const wanted = useGarden((s) => s.quality);
  const kind = useQuality((s) => s.device?.kind);
  // on Auto, what Auto is drawing now (the governor may have stepped it); otherwise what it would come back to
  const autoTier = choice === "auto" ? wanted : savedAuto;
  const summary = pictureSummary(choice, autoTier);
  const listId = useId();
  const radios = useRef<Array<HTMLButtonElement | null>>([]);

  // the chosen row says it is changing until the new tier is on screen (at once, when it already was)
  useEffect(() => {
    if (pending === null) return;
    const check = () => {
      if (changing()) return;
      setPending(null);
      setSaid(`Picture: ${summaryNow()}`);
    };
    const offs = [quality.subscribe(check), garden.subscribe(check)];
    const first = setTimeout(check, 0);
    const cap = setTimeout(() => setPending(null), CHANGING_MAX_MS);
    return () => {
      offs.forEach((off) => off());
      clearTimeout(first);
      clearTimeout(cap);
    };
  }, [pending]);

  const pick = (c: PictureChoice) => {
    if (c === choice && pending === null) return;
    setSaid("");
    setPending(c);
    choose(c);
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const at = radios.current.findIndex((r) => r === document.activeElement);
    const n = PICTURE_CHOICES.length;
    radios.current[(Math.max(0, at) + step + n) % n]?.focus();
  };

  return (
    <>
      <button
        type="button"
        className="gift-id-item gift-pic-row"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <Picture size={18} />
        <span className="gift-pic-label">Picture</span>
        <span className="gift-pic-now">{summary}</span>
        <Chevron size={16} className="gift-chevron" />
      </button>
      {open && (
        <div id={listId} className="gift-pic-choices" role="radiogroup" aria-label="Picture" onKeyDown={onKey}>
          {PICTURE_CHOICES.map((c, i) => {
            const changing = pending === c;
            const line = changing ? "Changing the picture…" : c === "auto" ? `Chosen for this ${deviceWord(kind)}: ${PICTURE_NAME[autoTier]}` : PICTURE_LINE[c];
            return (
              <button
                key={c}
                ref={(el) => {
                  radios.current[i] = el;
                }}
                type="button"
                role="radio"
                aria-checked={choice === c}
                tabIndex={choice === c ? 0 : -1}
                className={changing ? "gift-pic-choice is-changing" : "gift-pic-choice"}
                onClick={() => pick(c)}
              >
                <span className="gift-pic-dot" aria-hidden="true" />
                <span className="gift-pic-text">
                  <span className="gift-pic-name">{PICTURE_NAME[c]}</span>
                  <span className="gift-pic-line">{line}</span>
                  {c !== "auto" && !changing && above(c, autoTier) && <span className="gift-pic-warn">{pictureWarning(kind)}</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}
      <p className="gift-sr" role="status">
        {said}
      </p>
    </>
  );
}
