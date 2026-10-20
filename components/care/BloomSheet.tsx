"use client";
// "Send your bloom": once the flower is in full bloom (careStates fullBloom), the care card offers to send it to someone
// the colleague loves, as a picture card with a few words of their own (design A, "the window": components/care/drawCard).
//
// The sheet opens, and the garden photographs the flower for the card behind a still (components/garden/CardCamera):
// golden hour, fully open, framed by its own face. The card is lettered on the device as the person types (the faces
// waited for: components/care/cardFonts), shown as the sheet's preview, and encoded a moment after the last keystroke,
// so Send can open the share sheet inside the tap (components/care/sendCard). A phone sends it through its share sheet,
// with the line and the link to the living flower (an iPhone sends the picture alone and puts the line on the clipboard,
// and says so); a laptop saves the picture and puts the line on the clipboard. Where neither works (an app's own
// browser), the picture is shown to be pressed and saved. Words that would crowd the card (a message past what fits
// below the flower, a name too long for its line) are asked to be shorter, and Send waits, rather than being cut.
//
// The message is never sent anywhere but into the picture: it is not stored, logged or sent to the server, and it is
// gone when the sheet closes (a party device may be shared).
//
// Rendered into the body (the garden page's <main> is its own stacking context), as the gift flow's sheet: at the
// bottom on phones, riding above the on-screen keyboard (while it is up the sheet keeps only the preview, small, the
// fields and Send), beside the flower on a laptop, and on a phone held sideways the preview beside the fields. Focus
// starts on the heading, so the keyboard does not cover the preview at once; Tab stays inside; Escape closes (not
// while an input method is composing), and focus goes back to the button that opened it.
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { cardFileName, cleanTo, grownDays, grownWords, letterCount, MESSAGE_MAX, messageParagraphs, senderOf, shareText } from "@/components/care/bloomCard";
import { cardFonts, loadCardFonts } from "@/components/care/cardFonts";
import { drawCard, type CardWords } from "@/components/care/drawCard";
import { canShareFile, encodeCard, encodeCardNow, isIos, saveCard, shareCard } from "@/components/care/sendCard";
import { requestCardPhoto } from "@/components/garden/CardCamera";
import { copyText } from "@/components/gift/clipboard";
import { display } from "@/components/gift/fonts";
import { PUBLIC_ORIGIN, typedLink } from "@/components/party/logic";
import { say, type MeView } from "@/lib/client/plant";
import { primaryTouch } from "@/lib/garden/device";
import { SPECIES } from "@/lib/plant/species";
import "@/components/care/BloomSheet.css";

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
/** The picture is encoded this long after the last keystroke. */
const ENCODE_MS = 300;
/** A garden busy for a moment (the can pouring, a change of picture, a turn of the phone) is asked again, this often, for this long. */
const RETRY_MS = 700;
const RETRY_FOR_MS = 12_000;
const PASSING = new Set(["busy", "not-showing", "hidden", "resized"]);
/** Hard stops far beyond what the card holds, for safety only (the card's own limits are kind to keyboards). */
const HARD_MAX = 600;
const TO_HARD_MAX = 200;

type Mode = "send" | "save" | "press";
type Photo = { state: "taking" } | { state: "ready"; canvas: HTMLCanvasElement } | { state: "failed" };

/** How this device sends a picture: its share sheet (a phone), a saved file (a laptop), or a picture to press and save. */
function sendMode(): Mode {
  const probe = new File([new Uint8Array([0xff, 0xd8, 0xff])], "probe.jpg", { type: "image/jpeg" });
  const share = canShareFile(probe);
  if (primaryTouch()) return share ? "send" : "press";
  return "save";
}

/** An Enter or Escape that belongs to an input method choosing its letters, not to the page. */
const composing = (e: KeyboardEvent) => e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229;

export function BloomSheet({
  me,
  noun,
  onClose,
  onShown,
  returnFocus,
}: {
  me: MeView;
  noun: string;
  onClose: () => void;
  /** the sheet is on the page (the care card may step out of sight now) */
  onShown?: () => void;
  returnFocus: () => HTMLElement | null | undefined;
}) {
  const dock = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const card = useRef<HTMLCanvasElement>(null);
  const message$ = useRef<HTMLTextAreaElement>(null);
  const [photo, setPhoto] = useState<Photo>({ state: "taking" });
  const [attempt, setAttempt] = useState(0);
  const [to, setTo] = useState("");
  const [message, setMessage] = useState("");
  const [fontsTick, setFontsTick] = useState(0);
  const [overflow, setOverflow] = useState({ message: false, to: false });
  const [status, setStatus] = useState("");
  const [pressUrl, setPressUrl] = useState<string | null>(null);
  const [keyboard, setKeyboard] = useState(false);
  const [mode] = useState<Mode>(sendMode);
  const [ios] = useState(isIos);
  const ready = useRef<{ key: string; file: File } | null>(null);
  const busy = useRef(false);
  const fontsIn = useRef(false);
  const ids = useId();
  const toId = `${ids}-to`;
  const msgId = `${ids}-msg`;
  const countId = `${ids}-count`;
  const toHintId = `${ids}-tohint`;
  const close = useRef(onClose);
  const shown = useRef(onShown);
  const back = useRef(returnFocus);
  useEffect(() => {
    close.current = onClose;
    shown.current = onShown;
    back.current = returnFocus;
  });

  const species = SPECIES[me.plant.species].name;
  const origin = me.plant.rehearsal && typeof window !== "undefined" ? window.location.origin : PUBLIC_ORIGIN;
  const line = shareText(me.plant.species, me.plant.plot, origin);
  const fileName = cardFileName(me.plant.species);
  const letters = letterCount(message);
  const tooMany = letters > MESSAGE_MAX;
  const words = useMemo<CardWords>(
    () => ({
      to: cleanTo(to),
      paragraphs: messageParagraphs(message),
      from: senderOf(me.person),
      species,
      days: grownDays(me, Date.parse(me.now.at)),
      domain: typedLink(origin),
    }),
    [to, message, me, species, origin],
  );
  const key = `${attempt}|${photo.state}|${fontsTick}|${JSON.stringify(words)}`;

  // the photograph: asked of the garden at once, and again while the garden is busy for a moment
  useEffect(() => {
    let live = true;
    let timer = 0;
    const started = performance.now();
    const out = document.createElement("canvas");
    const ask = () => {
      requestCardPhoto(out).then(
        (c) => {
          if (live) setPhoto({ state: "ready", canvas: c });
          else c.width = c.height = 0;
        },
        (e: unknown) => {
          if (!live) return;
          const reason = e instanceof Error ? e.message : "";
          if (PASSING.has(reason) && performance.now() - started < RETRY_FOR_MS) timer = window.setTimeout(ask, RETRY_MS);
          else setPhoto({ state: "failed" });
        },
      );
    };
    ask();
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [attempt]);

  // the faces: the card is lettered again when one arrives (a canvas never redraws by itself), and only then
  const fonts = useMemo(() => cardFonts(), []);
  useEffect(() => {
    const set = document.fonts;
    if (!set?.addEventListener) return;
    const arrived = () => setFontsTick((n) => n + 1);
    set.addEventListener("loadingdone", arrived);
    return () => set.removeEventListener("loadingdone", arrived);
  }, []);
  // asked for the very letters on the card (the faces are split by script)
  const romanText = `${words.paragraphs.join(" ")} ${words.to} ${words.from}`;
  const italicText = `To ${words.to}, ${words.from}`;
  const sansText = `${species} · ${grownWords(words.days)} ${words.domain}`;
  useEffect(() => {
    let live = true;
    void loadCardFonts(fonts, { roman: romanText, italic: italicText, sans: sansText }).then((all) => {
      if (!live || !all || fontsIn.current) return;
      fontsIn.current = true;
      setFontsTick((n) => n + 1);
    });
    return () => {
      live = false;
    };
  }, [fonts, romanText, italicText, sansText]);

  // lettering the card, and the picture encoded a moment after the last change
  useEffect(() => {
    const c = card.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const laid = drawCard(ctx, photo.state === "ready" ? photo.canvas : null, words, fonts);
    setOverflow((was) => (was.message === laid.overflow.message && was.to === laid.overflow.to ? was : laid.overflow));
    ready.current = null;
    if (photo.state !== "ready") return;
    // words that crowd the card are never offered as a picture to press and save, as they are never sent
    const crowded = tooMany || laid.overflow.message || laid.overflow.to;
    if (crowded && mode === "press") {
      setPressUrl((was) => {
        if (was) URL.revokeObjectURL(was);
        return null;
      });
      return;
    }
    let live = true;
    const timer = window.setTimeout(() => {
      void encodeCard(c, fileName).then((file) => {
        if (!live || !file) return;
        ready.current = { key, file };
        if (mode === "press")
          setPressUrl((was) => {
            if (was) URL.revokeObjectURL(was);
            return URL.createObjectURL(file);
          });
      });
    }, ENCODE_MS);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [key, photo, words, fonts, fileName, mode, tooMany]);

  // the canvases and the pressed picture's address are let go with the sheet (Safari counts canvas memory)
  useEffect(
    () => () => {
      const c = card.current;
      if (c) c.width = c.height = 0;
    },
    [],
  );
  useEffect(() => {
    if (photo.state !== "ready") return;
    const c = photo.canvas;
    return () => {
      c.width = c.height = 0;
    };
  }, [photo]);
  useEffect(
    () => () => {
      if (pressUrl) URL.revokeObjectURL(pressUrl);
    },
    [pressUrl],
  );

  // above the on-screen keyboard, as the gift flow's sheet rides: the visual viewport's lost height counts as the
  // keyboard only while one of the sheet's fields is being written in and the page is not pinch-zoomed (a zoom shrinks
  // the visual viewport too)
  useEffect(() => {
    const vv = window.visualViewport;
    const el = dock.current;
    const sheet = box.current;
    if (!vv || !el || !sheet) return;
    const update = () => {
      const active = document.activeElement;
      const writing = sheet.contains(active) && (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement);
      const covered = writing && vv.scale <= 1.01 ? window.innerHeight - vv.height - vv.offsetTop : 0;
      el.style.setProperty("--gift-kb", covered > 80 ? `${Math.round(covered)}px` : "0px");
      setKeyboard(covered > 80);
    };
    // (focus has settled only once the event is over)
    let timer = 0;
    const settle = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(update, 0);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    sheet.addEventListener("focusin", settle);
    sheet.addEventListener("focusout", settle);
    return () => {
      window.clearTimeout(timer);
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      sheet.removeEventListener("focusin", settle);
      sheet.removeEventListener("focusout", settle);
    };
  }, []);

  // focus in on the heading, out to the button that opened it; and the care card told the sheet is up
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    heading.current?.focus({ preventScroll: true });
    shown.current?.();
    return () => {
      const el = back.current?.() ?? (before && before.isConnected ? before : null);
      el?.focus({ preventScroll: true });
    };
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Escape" && !composing(e)) {
      e.preventDefault();
      e.stopPropagation();
      close.current();
      return;
    }
    if (e.key !== "Tab" || !box.current) return;
    const items = Array.from(box.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) return;
    const [head, tail] = [items[0], items[items.length - 1]];
    if (e.shiftKey && (document.activeElement === head || document.activeElement === heading.current)) {
      e.preventDefault();
      tail.focus();
    } else if (!e.shiftKey && document.activeElement === tail) {
      e.preventDefault();
      head.focus();
    }
  };

  /** The picture as it is now: the one encoded ahead, or one made on the spot (nothing awaited: the tap must hold). */
  const fileNow = useCallback((): File | null => {
    if (ready.current && ready.current.key === key) return ready.current.file;
    const c = card.current;
    return c ? encodeCardNow(c, fileName) : null;
  }, [key, fileName]);

  const save = (file: File | null) => {
    void copyText(line);
    if (file && saveCard(file, fileName)) {
      setStatus("Saved to your downloads. The line with the link to your living flower is copied too, to paste beside it.");
    } else setStatus("The picture could not be saved here. Try another browser.");
  };

  const canAct = photo.state === "ready" && !tooMany && !overflow.message && !overflow.to;

  const send = () => {
    if (busy.current || !canAct) return;
    const file = fileNow();
    if (!file) return setStatus("The picture could not be made just now. Try again in a moment.");
    if (!canShareFile(file)) return save(file);
    busy.current = true;
    setStatus("");
    void shareCard(file, line).then((outcome) => {
      busy.current = false;
      if (outcome === "shared") {
        say(ios ? `Your ${noun} is glad to be shared. The link to it is copied, to paste under the picture.` : `Your ${noun} is glad to be shared.`, "thanks");
        close.current();
      } else if (outcome === "failed") save(file);
      else if (ios) setStatus("The link to your living flower is copied, ready to paste under the picture.");
    });
  };

  const saveNow = () => {
    if (!canAct) return;
    save(fileNow());
  };

  const retry = () => {
    setPhoto({ state: "taking" });
    setAttempt((n) => n + 1);
    // the button goes with the failure: focus stays in the sheet
    requestAnimationFrame(() => heading.current?.focus({ preventScroll: true }));
  };

  const messageHint = tooMany
    ? `A little shorter, please: the card holds ${MESSAGE_MAX} letters. `
    : overflow.message
      ? "A little shorter, please: these words would cover your flower. "
      : "";
  const toHint = overflow.to ? "A shorter name, please: it has to fit on one line." : "";
  // why Send waits, said once to a screen reader as it comes (the visible hints change with every letter typed)
  const waitHint = (toHint || messageHint).trim();

  return createPortal(
    <div className={`gift-root ${display.variable}`}>
      <div ref={dock} className="gift-dock bloom-dock" data-keyboard={keyboard || undefined}>
        <section ref={box} className="gift-sheet bloom-sheet" role="dialog" aria-modal="true" aria-labelledby={`${ids}-h`} onKeyDown={onKeyDown}>
          <div className="gift-sheet-body">
            <div className="bloom-layout">
              <div className="bloom-head">
                <p className="gift-eyebrow">In full bloom</p>
                <h2 id={`${ids}-h`} ref={heading} className="gift-title gift-title-sm" tabIndex={-1}>
                  Send your bloom
                </h2>
                <p className="gift-text">Your {species}, photographed at golden hour in your own garden, with a few words of yours.</p>
              </div>
              <div className="bloom-art">
                <div className="bloom-preview" data-state={photo.state}>
                  <canvas
                    ref={card}
                    width={1080}
                    height={1350}
                    role="img"
                    aria-label={`The card: your ${species} at golden hour, with your words`}
                    hidden={pressUrl !== null}
                  />
                  {pressUrl && (
                    // eslint-disable-next-line @next/next/no-img-element -- a picture made on the device, to press and save
                    <img src={pressUrl} alt={`The card: your ${species} at golden hour, with your words`} />
                  )}
                  {photo.state === "taking" && <p className="bloom-preview-note">Taking its picture at golden hour</p>}
                </div>
                {photo.state === "failed" && (
                  <div className="bloom-retry">
                    <p className="gift-note">The garden could not take the picture just now.</p>
                    <button type="button" className="gift-secondary" onClick={retry}>
                      Try again
                    </button>
                  </div>
                )}
                {pressUrl && <p className="gift-field-hint bloom-press">Press and hold the picture to save it.</p>}
              </div>
              <div className="bloom-fields">
                <div className="gift-field">
                  <label className="gift-label" htmlFor={toId}>
                    To <span className="bloom-optional">(optional)</span>
                  </label>
                  <input
                    id={toId}
                    className="gift-input"
                    type="text"
                    value={to}
                    onChange={(e) => setTo(e.target.value.slice(0, TO_HARD_MAX))}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" || composing(e)) return;
                      e.preventDefault();
                      message$.current?.focus();
                    }}
                    autoComplete="off"
                    autoCapitalize="words"
                    spellCheck={false}
                    enterKeyHint="next"
                    placeholder="Amma, Asha, my love"
                    aria-invalid={overflow.to || undefined}
                    aria-describedby={overflow.to ? toHintId : undefined}
                  />
                  {overflow.to && (
                    <p id={toHintId} className="bloom-count" data-over>
                      {toHint}
                    </p>
                  )}
                </div>
                <div className="gift-field">
                  <label className="gift-label" htmlFor={msgId}>
                    Your message
                  </label>
                  <textarea
                    id={msgId}
                    ref={message$}
                    className="gift-input bloom-message"
                    value={message}
                    onChange={(e) => setMessage(e.target.value.slice(0, HARD_MAX))}
                    rows={3}
                    autoCapitalize="sentences"
                    aria-describedby={countId}
                    aria-invalid={tooMany || overflow.message || undefined}
                    placeholder="A few words, if you like"
                  />
                  <p id={countId} className="bloom-count" data-over={tooMany || overflow.message || undefined}>
                    {messageHint}
                    <span aria-hidden={messageHint ? true : undefined}>
                      {letters} / {MESSAGE_MAX}
                    </span>
                  </p>
                </div>
                <p className="gift-note bloom-private">Your words go only into the picture. Nothing is kept.</p>
                {mode === "send" && ios && (
                  <p className="gift-note bloom-private">The picture goes on its own; the link to your living flower is copied, to paste under it.</p>
                )}
                <p className="gift-link-status bloom-status" role="status" aria-live="polite">
                  {status}
                </p>
                <p className="bloom-sr" role="status" aria-live="polite">
                  {waitHint}
                </p>
              </div>
            </div>
          </div>
          <div className="gift-sheet-foot bloom-foot">
            {mode === "send" && (
              <button type="button" className="gift-primary" disabled={!canAct} onClick={send}>
                Send
              </button>
            )}
            {mode === "save" && (
              <button type="button" className="gift-primary" disabled={!canAct} onClick={saveNow}>
                Save picture
              </button>
            )}
            <div className="gift-sheet-foot-row bloom-foot-more">
              {mode === "send" && (
                <button type="button" className="gift-secondary bloom-grow" disabled={!canAct} onClick={saveNow}>
                  Save picture
                </button>
              )}
              <button type="button" className="gift-secondary bloom-grow" onClick={() => close.current()}>
                Close
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>,
    document.body,
  );
}
