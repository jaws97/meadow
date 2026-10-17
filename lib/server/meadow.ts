// The shared Meadow snapshot: every plant's plot, species, sign name and coarse bands (stage, health, how open the
// flower is), caught up to the last completed hour. It carries nothing about the viewer, so one response serves
// everyone and the CDN can cache it (GET /api/meadow sends s-maxage=5 and an ETag); the viewer's own plot comes from
// GET /api/me.
//
// Building it catches every plant up in one pass: one weather load serves them all, one query loads the events each
// plant still has to fold in (filtered by the very hour that plant's base state is at, from the same read, so a
// checkpoint that moves between the two queries cannot drop events), and the advanced checkpoints are saved in a single
// statement with the same optimistic version check as a single visit (a plant whose version moved meanwhile is skipped
// and catches up on its next read; the statement runs through db.ts transaction(), so it waits a bounded time for row
// locks). Outside production nothing is saved, and rehearsal plants show only where env.ts showRehearsals() says so
// (never in production on or after 10 Nov). An instance shares one build among concurrent requests and reuses it for
// a few seconds, short enough that a new sprout reaches the big screen quickly.
import "server-only";
import type { SpeciesId } from "@/lib/plant/species";
import { catchUp, hourIndexOf, toVisual, type PlantState, type TimedEvent } from "@/lib/sim";
import { baseState } from "./catchup";
import { db, transaction } from "./db";
import { showRehearsals, writesDerivedState } from "./env";
import { bloomBand, healthBand, hourIso, istClock, stageOf, toRecordedEvent, toTimedEvent, type EventRow, type HealthBand, type Stage } from "./rules";
import { ensureWeather, loadWeather } from "./weather-store";

export interface MeadowPlot {
  plot: number;
  species: SpeciesId;
  /** the first name on the garden sign, or "A friend" */
  name: string;
  stage: Stage;
  health: HealthBand;
  /** 0 closed (or no flower yet) .. 3 fully open, at the snapshot's IST clock */
  bloom: 0 | 1 | 2 | 3;
  /** 1 for the first seed, 2 after a replant */
  generation: number;
}

export interface MeadowSnapshot {
  v: 1;
  /** the game hour the plants are caught up to, and when it started */
  h: number;
  at: string;
  count: number;
  plots: MeadowPlot[];
}

interface SnapshotRow {
  plant_id: string;
  person_id: string;
  first_name: string;
  show_name: boolean;
  species: SpeciesId;
  plot_index: number;
  planted_h: number;
  cp_h: number;
  cp_state: PlantState;
  cp_sim_version: number;
  cp_version: number;
}

/** How long one instance reuses a snapshot it built (the CDN adds its own s-maxage on top). */
export const REUSE_MS = 4_000;
let cached: { builtAtMs: number; h: number; snapshot: MeadowSnapshot } | null = null;
let building: Promise<MeadowSnapshot> | null = null;

/** The current Meadow snapshot, shared among concurrent callers and reused for a few seconds within the same hour. */
export function meadowSnapshot(now: Date = new Date()): Promise<MeadowSnapshot> {
  const nowH = hourIndexOf(now);
  if (cached && cached.h === nowH && now.getTime() - cached.builtAtMs < REUSE_MS) return Promise.resolve(cached.snapshot);
  if (building) return building;
  const run = buildSnapshot(now)
    .then((snapshot) => {
      cached = { builtAtMs: now.getTime(), h: nowH, snapshot };
      return snapshot;
    })
    .finally(() => {
      if (building === run) building = null;
    });
  building = run;
  return run;
}

async function buildSnapshot(now: Date): Promise<MeadowSnapshot> {
  const sql = db();
  const toH = hourIndexOf(now);
  const includeRehearsal = showRehearsals(toH);
  const rows = await sql<SnapshotRow[]>`
    select p.id as plant_id, pe.id as person_id, pe.first_name, pe.show_name, p.species, p.plot_index, p.planted_h,
           c.h as cp_h, c.state as cp_state, c.sim_version as cp_sim_version, c.version as cp_version
    from meadow.plants p
    join meadow.gardens g on g.id = p.garden_id
    join meadow.people pe on pe.id = g.person_id
    join meadow.checkpoints c on c.plant_id = p.id
    where ${includeRehearsal} or not p.rehearsal
    order by p.plot_index`;

  // the state each plant steps from (rebuilt from its planting when another model version wrote the checkpoint)
  const bases = rows.map((r) => {
    const planting = { speciesId: r.species, plantedH: r.planted_h, owner: r.person_id };
    return baseState({ h: r.cp_h, state: r.cp_state, simVersion: r.cp_sim_version, version: r.cp_version }, planting);
  });
  const states: PlantState[] = bases.map((b) => b.state);
  const behind = rows.flatMap((r, i) => (bases[i].state.h < toH || bases[i].rebuilt ? [i] : []));

  if (behind.length > 0) {
    const fromH = Math.min(...behind.map((i) => bases[i].state.h));
    await ensureWeather(fromH, toH);
    const weather = await loadWeather(fromH, toH);
    // each plant's events from the hour its own base state is at (read above), never from a later checkpoint
    const ids = behind.map((i) => rows[i].plant_id);
    const fromHs = behind.map((i) => bases[i].state.h);
    const eventRows = await sql<(EventRow & { plant_id: string })[]>`
      select e.plant_id, e.id, e.h, e.kind, e.amount, e.actor_id, e.client_event_id
      from meadow.plant_events e
      join unnest(${ids}::uuid[], ${fromHs}::int[]) as b(plant_id, from_h) on b.plant_id = e.plant_id
      where e.h >= b.from_h and e.h < ${toH}
      order by e.plant_id, e.h, e.id`;
    const byPlant = new Map<string, TimedEvent[]>();
    for (const r of eventRows) {
      const t = toTimedEvent(toRecordedEvent(r));
      if (!t) continue;
      const list = byPlant.get(r.plant_id);
      if (list) list.push(t);
      else byPlant.set(r.plant_id, [t]);
    }
    const updates: [string, number, string, number, number, number][] = [];
    for (const i of behind) {
      const r = rows[i], { state: base, rebuilt } = bases[i];
      const next = catchUp(base, byPlant.get(r.plant_id) ?? [], weather, toH);
      states[i] = next;
      if (next !== base || rebuilt) updates.push([r.plant_id, next.h, JSON.stringify(next), next.v, next.gen, r.cp_version]);
    }
    if (updates.length > 0 && writesDerivedState()) {
      await transaction((tx) => tx`
        with v (plant_id, h, state, sim_version, generation, expected) as (values ${tx(updates)}),
        c as (
          update meadow.checkpoints c
          set h = v.h::int, state = v.state::jsonb, sim_version = v.sim_version::smallint, version = c.version + 1, updated_at = now()
          from v where c.plant_id = v.plant_id::uuid and c.version = v.expected::int
          returning c.plant_id
        )
        update meadow.plants p set generation = v.generation::smallint
        from v where p.id = v.plant_id::uuid and p.id in (select plant_id from c) and p.generation <> v.generation::smallint`);
    }
  }

  const clock = istClock(now);
  const plots: MeadowPlot[] = rows.map((r, i) => {
    const s = states[i], visual = toVisual(s, null, clock);
    return {
      plot: r.plot_index,
      species: r.species,
      name: r.show_name ? r.first_name : "A friend",
      stage: stageOf(s),
      health: healthBand(visual),
      bloom: bloomBand(visual),
      generation: s.gen,
    };
  });
  return { v: 1, h: toH, at: hourIso(toH), count: plots.length, plots };
}
