"use client";
// The development overlay: every simulation and environment knob in the
// store, a handful of one-click presets, and the Bangalore clock readout.
// It is plain HTML laid over the canvas, so it never touches the render loop.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { garden, useGarden, type GardenState, type Quality } from "@/lib/garden/store";
import { SPECIES_LIST } from "@/lib/plant/species";
import { STAGES, stageOf } from "@/lib/plant/growth";

type SliderKey = "growth" | "bloom" | "health" | "moisture" | "scorch" | "wind" | "cloud" | "rain";

const SLIDERS: ReadonlyArray<{ key: SliderKey; label: string }> = [
  { key: "growth", label: "Growth" },
  { key: "bloom", label: "Bloom" },
  { key: "health", label: "Health" },
  { key: "moisture", label: "Moisture" },
  { key: "scorch", label: "Scorch" },
  { key: "wind", label: "Wind" },
  { key: "cloud", label: "Cloud" },
  { key: "rain", label: "Rain" },
];

const QUALITIES: ReadonlyArray<Quality> = ["cinematic", "balanced", "lite"];

const PRESETS: ReadonlyArray<{ label: string; patch: Partial<GardenState> }> = [
  { label: "Seed", patch: { growth: 0.02, bloom: 0 } },
  { label: "Sprout", patch: { growth: 0.15, bloom: 0 } },
  { label: "Growing", patch: { growth: 0.5, bloom: 0 } },
  { label: "Bud", patch: { growth: 0.8, bloom: 0 } },
  { label: "Bloom", patch: { growth: 1, bloom: 1, health: 1, moisture: 0.6, scorch: 0 } },
  { label: "Thirsty", patch: { moisture: 0.08, health: 0.55 } },
  { label: "Drowned", patch: { moisture: 1, health: 0.4 } },
  { label: "Scorched", patch: { scorch: 0.8, moisture: 0.15, health: 0.6, cloud: 0, hour: 13.5, autoClock: false } },
  { label: "Golden hour", patch: { hour: 17.6, cloud: 0.15, autoClock: false } },
  { label: "Night", patch: { hour: 21.5, cloud: 0.1, autoClock: false } },
  { label: "Rain", patch: { rain: 0.8, cloud: 0.9, hour: 15, autoClock: false } },
];

const COLLAPSED_KEY = "disney-garden:devpanel-collapsed";

/** Pause in typing before a new seed reaches the store (and rebuilds the plant). */
const SEED_COMMIT_MS = 350;

const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n));

/** Fractional hour -> "HH:MM"; 24.0 wraps to 00:00. */
function formatHour(hour: number): string {
  const minutes = ((Math.round(hour * 60) % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
}

function stageLabel(growth: number): string {
  const id = stageOf(growth);
  for (const st of STAGES) if (st.id === id) return st.label;
  return STAGES[0].label;
}

// The collapsed flag lives in localStorage, exposed through a tiny external
// store so React reads it hydration-safely: the server snapshot is always
// "expanded", and the stored value is applied once the client has hydrated.
let collapsedMemory = false;
const collapsedListeners = new Set<() => void>();

function readCollapsed(): boolean {
  try {
    const v = window.localStorage.getItem(COLLAPSED_KEY);
    if (v !== null) return v === "1";
  } catch {
    // storage unavailable (private mode, blocked); fall back to memory
  }
  return collapsedMemory;
}

function writeCollapsed(v: boolean): void {
  collapsedMemory = v;
  try {
    window.localStorage.setItem(COLLAPSED_KEY, v ? "1" : "0");
  } catch {
    // the flag just does not persist across reloads
  }
  collapsedListeners.forEach((l) => l());
}

function subscribeCollapsed(l: () => void): () => void {
  collapsedListeners.add(l);
  window.addEventListener("storage", l);
  return () => {
    collapsedListeners.delete(l);
    window.removeEventListener("storage", l);
  };
}

const serverCollapsed = () => false;

const TEXT_INPUT_TYPES = new Set(["text", "search", "number", "email", "url", "password", "tel"]);

/** True when a keypress would be typed into something, so hotkeys must stay out of the way. */
function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  if (t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return true;
  if (t instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(t.type);
  return false;
}

const fieldClass =
  "mt-1 w-full rounded-md border border-white/10 bg-black/40 px-2 py-1 text-white/85 outline-none focus:border-white/30";
const smallButtonClass =
  "rounded-lg border border-white/10 bg-white/10 px-2 py-1 text-[11px] leading-tight text-white/85 transition-colors hover:bg-white/20 active:bg-white/25";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-[10px] font-medium tracking-wider text-white/40 uppercase select-none">{title}</h3>
      {children}
    </section>
  );
}

function Slider({
  label,
  value,
  display,
  min = 0,
  max = 1,
  step = 0.01,
  onChange,
}: {
  label: string;
  value: number;
  display?: string;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between">
        <span>{label}</span>
        <span className="text-white/55 tabular-nums">{display ?? value.toFixed(2)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(e.currentTarget.valueAsNumber)}
        className="mt-1 block w-full accent-emerald-400"
      />
    </label>
  );
}

function StoreSlider({ k, label }: { k: SliderKey; label: string }) {
  const value = useGarden((s) => s[k]);
  const onChange = useCallback(
    (v: number) => {
      const patch: Partial<GardenState> = {};
      patch[k] = v;
      garden.set(patch);
    },
    [k],
  );
  return <Slider label={label} value={value} onChange={onChange} />;
}

function HourSlider() {
  const hour = useGarden((s) => s.hour);
  return (
    <Slider
      label="Hour"
      value={hour}
      display={formatHour(hour)}
      min={0}
      max={24}
      step={0.05}
      onChange={(v) => garden.set({ hour: v, autoClock: false })}
    />
  );
}

function SpeciesSelect() {
  const speciesId = useGarden((s) => s.speciesId);
  return (
    <label className="block">
      <span>Species</span>
      <select
        value={speciesId}
        onChange={(e) => {
          const next = SPECIES_LIST.find((sp) => sp.id === e.currentTarget.value);
          if (next) garden.set({ speciesId: next.id });
        }}
        className={fieldClass}
      >
        {SPECIES_LIST.map((sp) => (
          <option key={sp.id} value={sp.id} className="bg-neutral-900 text-white">
            {sp.name} ({sp.film})
          </option>
        ))}
      </select>
    </label>
  );
}

// A seed change rebuilds every geometry and remounts the whole plant, so the
// field keeps a local draft and commits it after a pause, on Enter, on blur,
// or when the panel unmounts; never once per keystroke.
function SeedInput() {
  const seed = useGarden((s) => s.seed);
  const [draft, setDraft] = useState(seed);
  /** the store value this field last wrote or adopted */
  const known = useRef(seed);
  const pending = useRef<string | null>(null);
  const timer = useRef<number | null>(null);

  const cancel = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    pending.current = null;
  }, []);

  const commit = useCallback(() => {
    const v = pending.current;
    cancel();
    if (v === null || v === known.current) return;
    known.current = v;
    garden.set({ seed: v });
  }, [cancel]);

  const schedule = useCallback(
    (v: string) => {
      setDraft(v);
      cancel();
      pending.current = v;
      timer.current = window.setTimeout(commit, SEED_COMMIT_MS);
    },
    [cancel, commit],
  );

  // An outside change (Reset, a preset) replaces the draft and drops any pending commit.
  useEffect(() => {
    if (seed !== known.current) {
      known.current = seed;
      cancel();
      setDraft(seed);
    }
  }, [seed, cancel]);

  // Unmounting (panel hidden) flushes whatever was still pending.
  useEffect(() => commit, [commit]);

  return (
    <label className="block">
      <span>Seed</span>
      <input
        type="text"
        value={draft}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => schedule(e.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
        className={fieldClass}
      />
    </label>
  );
}

function QualitySelect() {
  const quality = useGarden((s) => s.quality);
  return (
    <label className="block">
      <span>Quality</span>
      <select
        value={quality}
        onChange={(e) => {
          const next = QUALITIES.find((q) => q === e.currentTarget.value);
          if (next) garden.set({ quality: next });
        }}
        className={fieldClass}
      >
        {QUALITIES.map((q) => (
          <option key={q} value={q} className="bg-neutral-900 text-white">
            {q}
          </option>
        ))}
      </select>
    </label>
  );
}

function AutoClockToggle() {
  const autoClock = useGarden((s) => s.autoClock);
  return (
    <label className="flex cursor-pointer items-center gap-2 select-none">
      <input
        type="checkbox"
        checked={autoClock}
        onChange={(e) => garden.set({ autoClock: e.currentTarget.checked })}
        className="accent-emerald-400"
      />
      <span>Live Bangalore clock</span>
    </label>
  );
}

function Readout() {
  const growth = useGarden((s) => s.growth);
  const hour = useGarden((s) => s.hour);
  const autoClock = useGarden((s) => s.autoClock);
  return (
    <div className="flex items-center justify-between select-none">
      <span className="text-white/70">{stageLabel(growth)}</span>
      <span className="flex items-center gap-1.5 tabular-nums">
        <span>{formatHour(hour)}</span>
        {autoClock && (
          <span className="rounded-full border border-emerald-400/30 bg-emerald-500/20 px-1.5 py-px text-[10px] leading-tight text-emerald-300">
            live
          </span>
        )}
      </span>
    </div>
  );
}

export function DevPanel() {
  const collapsed = useSyncExternalStore(subscribeCollapsed, readCollapsed, serverCollapsed);
  const toggle = useCallback(() => writeCollapsed(!readCollapsed()), []);
  // ?nopanel hides the panel entirely, for clean screenshots and the big screen.
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    // Read after hydration on purpose: the server cannot see the query, so state starts visible on both sides.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (new URLSearchParams(window.location.search).has("nopanel")) setHidden(true);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "h" && e.key !== "H") return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  if (hidden) return null;

  // dvh keeps the bottom of the panel above phone browser toolbars; the
  // backdrop blur over a live canvas re-blurs every frame, so it is
  // desktop-only and small screens get a more opaque backing instead.
  return (
    <aside
      aria-label="Development panel"
      className="fixed top-4 right-4 z-10 max-h-[calc(100dvh-2rem)] w-72 space-y-3 overflow-y-auto rounded-2xl border border-white/10 bg-black/70 p-3 text-xs text-white/85 md:bg-black/55 md:backdrop-blur-md"
    >
      <header className="space-y-2">
        <div className="flex items-start justify-between gap-2 select-none">
          <div>
            <h2 className="text-sm font-semibold text-white">Disney Garden</h2>
            <p className="text-[10px] text-white/45">visual development build</p>
          </div>
          <button
            type="button"
            onClick={toggle}
            aria-expanded={!collapsed}
            title={collapsed ? "Show panel (H)" : "Hide panel (H)"}
            className="rounded-md border border-white/10 bg-white/10 px-1.5 py-0.5 text-[10px] text-white/70 transition-colors hover:bg-white/20"
          >
            {collapsed ? "show" : "hide"}
          </button>
        </div>
        <Readout />
      </header>

      {!collapsed && (
        <div className="space-y-3">
          <Section title="Plant">
            <SpeciesSelect />
            <SeedInput />
          </Section>

          <Section title="Simulation">
            {SLIDERS.map((s) => (
              <StoreSlider key={s.key} k={s.key} label={s.label} />
            ))}
          </Section>

          <Section title="Sky">
            <HourSlider />
            <AutoClockToggle />
          </Section>

          <Section title="Render">
            <QualitySelect />
          </Section>

          <Section title="Presets">
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button key={p.label} type="button" onClick={() => garden.set(p.patch)} className={smallButtonClass}>
                  {p.label}
                </button>
              ))}
            </div>
          </Section>

          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => garden.set({ moisture: Math.min(1, garden.get().moisture + 0.35) })}
              className={`${smallButtonClass} flex-1 border-sky-400/30 bg-sky-500/20 hover:bg-sky-500/30`}
            >
              Water
            </button>
            <button type="button" onClick={() => garden.reset()} className={`${smallButtonClass} flex-1`}>
              Reset
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
