// End-to-end smoke test of the real API against a running server (default http://localhost:3000, or SMOKE_BASE_URL).
// Plants two test seeds named "Test Seed (delete me)" and walks the API: retries, care and its limits, sprinkles, the
// Meadow, a catch-up across completed hours, personal garden links opened on other devices (sign in, the switch prompt,
// switch back, reset, sign out), the practice-copy guard and the weather; then DELETES every row it created (people
// cascade to their gardens, plants, events, checkpoints, sprinkles, sessions and links) and checks that nothing is left.
//
//   node --env-file=.env.local scripts/smoke-api.mjs
//
// Against the local dev server, which is not the production deployment (lib/server/env.ts): plantings are marked as
// rehearsals, and the server must write no checkpoint and no weather row; the test checks both.
//
// SMOKE_EXPECT=production runs it against a production-mode server instead (a local `next build && next start`, or the
// Production deployment) during a rehearsal before the game clock starts (MEADOW_REHEARSAL=1, before 10 Nov): it then
// expects the Secure cookie, catch-ups saved as checkpoints (single and bulk), and weather rows written once, and the
// cleanup also removes the pre-game weather hours the run wrote. SMOKE_STRICT_BASE_URL may name a second production
// server of the same build WITHOUT MEADOW_REHEARSAL: its Meadow must hide the rehearsal plants and it must refuse to
// plant before the opening hour.
//
// SMOKE_PARTY_CODE (or the first code in MEADOW_PARTY_CODE) is sent with every planting; when one is known the test
// also checks that a planting without it, or with an old one, is refused.
//
// The database is only used for setup tweaks, the cleanup and the before/after counts (POSTGRES_URL_NON_POOLING).
// Tokens, cookies, garden links and the party code are never printed.
import { randomUUID } from "node:crypto";
import { connect } from "./db-connect.mjs";

const BASE = (process.env.SMOKE_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const STRICT_BASE = process.env.SMOKE_STRICT_BASE_URL ? process.env.SMOKE_STRICT_BASE_URL.replace(/\/$/, "") : null;
const PRODUCTION = process.env.SMOKE_EXPECT === "production";
const PARTY_CODE = process.env.SMOKE_PARTY_CODE || (process.env.MEADOW_PARTY_CODE ?? "").split(",")[0].trim() || null;
const withCode = (body) => (PARTY_CODE ? { ...body, partyCode: PARTY_CODE } : body);
const TEST_NAME = "Test Seed (delete me)";
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

let failures = 0;
function check(ok, label, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? `  (${detail})` : ""}`);
  return ok;
}

/** A browser's cookie jar for the two meadow cookies, honouring Max-Age=0 (cleared). */
class Jar {
  constructor() { this.cookies = new Map(); this.attrs = new Map(); this.lastSet = []; }
  absorb(res) {
    this.lastSet = [];
    for (const line of res.headers.getSetCookie?.() ?? []) {
      const m = /^(meadow_session|meadow_prev)=([^;]*)(.*)$/i.exec(line);
      if (!m) continue;
      this.lastSet.push(m[1]);
      if (/max-age=0\b/i.test(m[3]) || m[2] === "") this.cookies.delete(m[1]);
      else { this.cookies.set(m[1], m[2]); this.attrs.set(m[1], m[3]); }
    }
  }
  has(name) { return this.cookies.has(name); }
  header() {
    const pairs = [...this.cookies].map(([k, v]) => `${k}=${v}`);
    return pairs.length ? { cookie: pairs.join("; ") } : {};
  }
}

async function call(method, path, { jar, body, headers = {}, raw, base = BASE } = {}) {
  const res = await fetch(base + path, {
    method,
    redirect: "manual",
    headers: { ...(body !== undefined && !raw ? { "content-type": "application/json" } : {}), ...(jar?.header() ?? {}), ...headers },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    signal: AbortSignal.timeout(90_000),
  });
  jar?.absorb(res);
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  return { status: res.status, headers: res.headers, json };
}

const linkToken = (link) => (/#k=([A-Za-z0-9_-]+)$/.exec(String(link ?? "")) ?? [])[1] ?? "";

async function counts(sql) {
  const [r] = await sql`
    select (select count(*)::int from meadow.people) as people,
           (select count(*)::int from meadow.plants) as plants,
           (select count(*)::int from meadow.plant_events) as events,
           (select count(*)::int from meadow.sessions) as sessions,
           (select count(*)::int from meadow.garden_links) as links,
           (select count(*)::int from meadow.sprinkles) as sprinkles,
           (select count(*)::int from meadow.checkpoints) as checkpoints,
           (select count(*)::int from meadow.weather_hours) as weather,
           (select count(*)::int from meadow.people where first_name = ${TEST_NAME}) as test_people`;
  return r;
}

async function run(sql) {
  const a = new Jar(), b = new Jar();

  // 1. plant, and retries
  const seedId = randomUUID();
  if (PARTY_CODE) {
    const noCode = await call("POST", "/api/seed", { body: { firstName: TEST_NAME, species: "rose", clientEventId: randomUUID() } });
    check(noCode.status === 403 && noCode.json?.error === "party_code_required", "a planting without the party code is refused kindly", noCode.json?.message);
    const oldCode = await call("POST", "/api/seed", { body: { firstName: TEST_NAME, species: "rose", clientEventId: randomUUID(), partyCode: `${PARTY_CODE}x` } });
    check(oldCode.status === 403 && oldCode.json?.error === "party_code_wrong", "a planting with an old party code is refused kindly", oldCode.json?.message);
  } else {
    console.log("note: no party code for this run (SMOKE_PARTY_CODE); the server must not require one");
  }
  const seed = await call("POST", "/api/seed", { jar: a, body: withCode({ firstName: TEST_NAME, species: "marigold", clientEventId: seedId }) });
  if (!check(seed.status === 201, "POST /api/seed plants a test seed", `status ${seed.status} ${seed.json?.error ?? ""} ${seed.json?.message ?? ""}`)) return;
  const plotA = seed.json.me.plant.plot;
  const tokenA = linkToken(seed.json.link);
  check(TOKEN_RE.test(tokenA) && new URL(seed.json.link).pathname === "/garden", "the garden link is /garden#k=<token>: the token rides in the fragment", `${BASE}/garden#k=<43 characters, not shown>`);
  const attrs = a.attrs.get("meadow_session") ?? "";
  check(a.has("meadow_session") && /httponly/i.test(attrs) && /samesite=lax/i.test(attrs), "the session cookie is httpOnly and SameSite=Lax");
  if (PRODUCTION) check(/;\s*secure/i.test(attrs), "in production the session cookie is Secure");
  check(seed.json.me.plant.rehearsal === true,
    PRODUCTION ? "a planting before the game clock (MEADOW_REHEARSAL=1) is marked as a rehearsal" : "a planting through the dev server is marked as a rehearsal",
    `plot ${plotA}, h ${seed.json.me.plant.plantedH}`);

  const again = await call("POST", "/api/seed", { body: withCode({ firstName: TEST_NAME, species: "marigold", clientEventId: seedId }) });
  check(again.status === 200 && again.json?.replay === true && again.json.me.plant.plot === plotA, "a retried planting (same id, name and species) returns the same plant", `status ${again.status}`);
  const sameDevice = new Jar();
  sameDevice.cookies = new Map(a.cookies);
  const againHere = await call("POST", "/api/seed", { jar: sameDevice, body: withCode({ firstName: TEST_NAME, species: "marigold", clientEventId: seedId }) });
  check(againHere.status === 200 && againHere.json?.replay === true && TOKEN_RE.test(linkToken(againHere.json?.link)) && !sameDevice.lastSet.includes("meadow_session"),
    "a retry from the device that planted still gets its link, and no new session", `status ${againHere.status}`);
  const stolen = await call("POST", "/api/seed", { body: withCode({ firstName: "Someone Else", species: "rose", clientEventId: seedId }) });
  check(stolen.status === 409 && stolen.json?.error === "seed_request_used", "the same id with other details is refused (the id is not a key to the garden)", stolen.json?.message);
  const shortId = await call("POST", "/api/seed", { body: withCode({ firstName: TEST_NAME, species: "rose", clientEventId: "abcdefgh" }) });
  check(shortId.status === 400 && shortId.json?.error === "client_event_id", "a planting id that is not a UUID is a 400");
  const twice = await call("POST", "/api/seed", { jar: a, body: withCode({ firstName: TEST_NAME, species: "rose", clientEventId: randomUUID() }) });
  check(twice.status === 409 && twice.json?.error === "already_planted", "a second seed on the same device is declined kindly", twice.json?.message);

  // 2. care
  const waterId = randomUUID();
  const water = await call("POST", "/api/care", { jar: a, body: { kind: "water", clientEventId: waterId } });
  check(water.status === 200 && water.json?.event?.duplicate === false, "POST /api/care water records a can", `status ${water.status} ${water.json?.message ?? ""}`);
  check(water.json?.me?.pending?.some((e) => e.kind === "water"), "the can shows as pending until the hour completes");
  const retry = await call("POST", "/api/care", { jar: a, body: { kind: "water", clientEventId: waterId } });
  check(retry.status === 200 && retry.json?.event?.duplicate === true, "retrying the same clientEventId is idempotent");
  const soon = await call("POST", "/api/care", { jar: a, body: { kind: "water", clientEventId: randomUUID() } });
  check(soon.status === 429 && soon.json?.error === "too_soon" && typeof soon.json?.retryAt === "string", "a second can within 4 hours is declined with retryAt", soon.json?.message);
  const shade = await call("POST", "/api/care", { jar: a, body: { kind: "shade", on: true, clientEventId: randomUUID() } });
  check(shade.status === 200 && shade.json?.me?.care?.shade === true, "the shade cloth goes on");
  const [{ n: eventsBefore }] = await sql`select count(*)::int as n from meadow.plant_events e join meadow.plants p on p.id = e.plant_id where p.plot_index = ${plotA}`;
  const shadeAgain = await call("POST", "/api/care", { jar: a, body: { kind: "shade", on: true, clientEventId: randomUUID() } });
  const [{ n: eventsAfter }] = await sql`select count(*)::int as n from meadow.plant_events e join meadow.plants p on p.id = e.plant_id where p.plot_index = ${plotA}`;
  check(shadeAgain.status === 200 && shadeAgain.json?.event?.unchanged === true && eventsAfter === eventsBefore, "shade on when it is already on records nothing", `events ${eventsBefore} -> ${eventsAfter}`);
  const toggles = [];
  for (let i = 0; i < 5; i++) toggles.push((await call("POST", "/api/care", { jar: a, body: { kind: "cover", on: i % 2 === 0, clientEventId: randomUUID() } })).status);
  check(toggles.slice(0, 4).every((s) => s === 200) && toggles[4] === 429, "four cover changes an hour are fine, the fifth waits for the next hour", toggles.join(","));
  const badCare = await call("POST", "/api/care", { jar: a, body: { kind: "cover", clientEventId: randomUUID() } });
  check(badCare.status === 400 && badCare.json?.error === "on_required", "a cover without on/off is a 400 with a reason", badCare.json?.message);
  const revive = await call("POST", "/api/care", { jar: a, body: { kind: "revive", clientEventId: randomUUID() } });
  check(revive.status === 409 && revive.json?.error === "not_needed", "Fairy Dust is declined for a plant that is awake");

  // 3. read
  const me = await call("GET", "/api/me", { jar: a });
  check(me.status === 200 && me.json?.plant?.plot === plotA && typeof me.json?.visual?.says === "string",
    "GET /api/me returns the caught-up plant", `stage ${me.json?.state?.stage}, says "${me.json?.visual?.says}", canAdvice ${me.json?.visual?.canAdvice}`);
  check(me.headers.get("cache-control")?.includes("no-store"), "GET /api/me is never cached");
  const anon = await call("GET", "/api/me");
  check(anon.status === 401 && anon.json?.error === "no_session", "GET /api/me without a session is a calm 401");

  // 4. a friend sprinkles
  const seedB = await call("POST", "/api/seed", { jar: b, body: withCode({ firstName: TEST_NAME, species: "jasmine", showName: false, clientEventId: randomUUID() }) });
  check(seedB.status === 201, "a second test seed is planted", `plot ${seedB.json?.me?.plant?.plot}`);
  const plotB = seedB.json?.me?.plant?.plot;
  const spr = await call("POST", "/api/sprinkle", { jar: b, body: { plot: plotA, clientEventId: randomUUID() } });
  check(spr.status === 200 && spr.json?.counts === true, "POST /api/sprinkle lands on a friend's plant", spr.json?.message);
  const spr2 = await call("POST", "/api/sprinkle", { jar: b, body: { plot: plotA, clientEventId: randomUUID() } });
  check(spr2.status === 409 && spr2.json?.error === "sprinkled_today", "one sprinkle per person per day", spr2.json?.message);
  const own = await call("POST", "/api/sprinkle", { jar: a, body: { plot: plotA, clientEventId: randomUUID() } });
  check(own.status === 400 && own.json?.error === "own_plant", "sprinkling your own flower is declined", own.json?.message);
  const meAfter = await call("GET", "/api/me", { jar: a });
  check(meAfter.json?.friendsToday?.includes("A friend"), "the friend's sprinkle shows on GET /api/me (name kept private)");

  // 5. the Meadow
  const meadow = await call("GET", "/api/meadow");
  const plots = meadow.json?.plots ?? [];
  const pa = plots.find((p) => p.plot === plotA), pb = plots.find((p) => p.plot === plotB);
  check(meadow.status === 200 && pa?.name === TEST_NAME && pb?.name === "A friend",
    `GET /api/meadow lists both plants (${PRODUCTION ? "a production rehearsal before the game clock" : "a dev server"} shows rehearsals)`, `count ${meadow.json?.count}, plot ${plotA}: ${pa?.species}/${pa?.stage}/${pa?.health}/bloom ${pa?.bloom}`);
  const etag = meadow.headers.get("etag");
  check(Boolean(etag) && /s-maxage=5\b/.test(meadow.headers.get("cache-control") ?? "") && !meadow.headers.get("set-cookie"),
    "the snapshot has an ETag, s-maxage=5 and no cookie", meadow.headers.get("cache-control"));
  const notModified = await call("GET", "/api/meadow", { headers: { "if-none-match": etag } });
  check(notModified.status === 304, "If-None-Match gets a 304", `status ${notModified.status}`);

  // 6. catch-up across completed hours: backdate both plantings by six hours and mark their checkpoints as written by
  // another model version, so the server must rebuild them from planting with real weather. A dev server must compute
  // the plants without saving a checkpoint or writing a weather row; a production server must save both catch-ups (the
  // single one from GET /api/me, the bulk one from the Meadow) and write the weather hours once.
  const [{ n: weatherBefore }] = await sql`select count(*)::int as n from meadow.weather_hours`;
  const backdate = async (plot) => {
    const [p] = await sql`
      update meadow.plants set planted_h = planted_h - 6 where plot_index = ${plot}
        and garden_id in (select g.id from meadow.gardens g join meadow.people pe on pe.id = g.person_id where pe.first_name = ${TEST_NAME})
      returning id`;
    await sql`update meadow.checkpoints set sim_version = 0 where plant_id = ${p.id}`;
  };
  await backdate(plotA);
  await backdate(plotB);
  const caught = await call("GET", "/api/me", { jar: a });
  const st = caught.json?.state, now = caught.json?.now, wxs = caught.json?.weather;
  // Open-Meteo may not have published the hour that has only just completed; anything older must be there
  const caughtUp = st?.h === now?.h || (wxs?.upToDate === false && wxs?.waitingFromH === now?.h - 1 && st?.h === now?.h - 1);
  check(caught.status === 200 && caughtUp && st?.h > now?.h - 6,
    "GET /api/me rebuilds a plant six hours behind from its events and real weather",
    `state h ${st?.h}, now h ${now?.h}, weather upToDate ${wxs?.upToDate}, moisture ${caught.json?.visual?.moisture?.toFixed?.(2)}`);
  check(caught.json?.pending?.some((e) => e.kind === "water"), "this hour's can is still pending after the rebuild");
  await new Promise((r) => setTimeout(r, 5_000)); // past the Meadow's few-second reuse window
  const meadow2 = await call("GET", "/api/meadow");
  check(meadow2.status === 200 && meadow2.json?.plots?.some((p) => p.plot === plotB), "GET /api/meadow catches every plant up in one pass");
  const cps = await sql`
    select c.sim_version, c.h, p.planted_h from meadow.checkpoints c join meadow.plants p on p.id = c.plant_id
    join meadow.gardens g on g.id = p.garden_id join meadow.people pe on pe.id = g.person_id
    where pe.first_name = ${TEST_NAME}`;
  const [{ n: weatherAfter }] = await sql`select count(*)::int as n from meadow.weather_hours`;
  if (PRODUCTION) {
    check(cps.length === 2 && cps.every((c) => c.sim_version > 0 && c.h > c.planted_h),
      "production saved both catch-ups as checkpoints (GET /api/me's and the Meadow's bulk update)", JSON.stringify(cps));
    check(weatherAfter > weatherBefore, "production wrote the fetched weather hours to the shared store", `${weatherBefore} -> ${weatherAfter}`);
    await call("GET", "/api/me", { jar: a });
    const [{ n: weatherThird }] = await sql`select count(*)::int as n from meadow.weather_hours`;
    check(weatherThird === weatherAfter, "a second visit writes no weather row again (each hour is stored once)", `${weatherAfter} -> ${weatherThird}`);
  } else {
    check(cps.length === 2 && cps.every((c) => c.sim_version === 0), "the dev server saved no checkpoint (only production writes derived state)", JSON.stringify(cps));
    check(weatherAfter === weatherBefore, "the dev server wrote no weather row (it keeps fetched hours in memory)", `${weatherBefore} -> ${weatherAfter}`);
  }

  // 7. personal garden links on other devices
  const laptop = new Jar();
  const open = await call("POST", "/api/session", { jar: laptop, body: { token: tokenA } });
  check(open.status === 200 && open.json?.status === "signed_in" && open.json?.person?.plot === plotA && laptop.has("meadow_session"),
    "POST /api/session opens the garden link on an empty device", `status ${open.status}`);
  const meLaptop = await call("GET", "/api/me", { jar: laptop });
  check(meLaptop.status === 200 && meLaptop.json?.plant?.plot === plotA, "the new device sees the same garden");
  const openAgain = await call("POST", "/api/session", { jar: laptop, body: { token: tokenA } });
  check(openAgain.status === 200 && openAgain.json?.status === "already_here" && laptop.lastSet.length === 0, "opening it again there changes nothing");

  const ask = await call("POST", "/api/session", { jar: b, body: { token: tokenA } });
  check(ask.status === 409 && ask.json?.error === "switch_needed" && ask.json?.current?.plot === plotB && ask.json?.target?.plot === plotA && b.lastSet.length === 0,
    "a device holding another garden is asked first, and nothing changes", ask.json?.message);
  const stillB = await call("GET", "/api/me", { jar: b });
  check(stillB.json?.plant?.plot === plotB, "that device still shows its own garden");
  const sw = await call("POST", "/api/session", { jar: b, body: { token: tokenA, confirmSwitch: true } });
  check(sw.status === 200 && sw.json?.status === "switched" && b.has("meadow_prev") && /httponly/i.test(b.attrs.get("meadow_prev") ?? ""),
    "with confirmSwitch it switches, keeping the old garden in an httpOnly cookie", `status ${sw.status}`);
  const status = await call("GET", "/api/session", { jar: b });
  check(status.json?.person?.plot === plotA && status.json?.previous?.plot === plotB, "GET /api/session shows the garden here and the one to switch back to");
  const back = await call("POST", "/api/session/back", { jar: b, body: {} });
  const meBack = await call("GET", "/api/me", { jar: b });
  check(back.status === 200 && back.json?.person?.plot === plotB && meBack.json?.plant?.plot === plotB && !b.has("meadow_prev"),
    "POST /api/session/back returns to the previous garden", `status ${back.status}`);
  const noBack = await call("POST", "/api/session/back", { jar: b, body: {} });
  check(noBack.status === 409 && noBack.json?.error === "nothing_to_switch_back", "with nothing to return to, back says so");

  const legacy = await call("GET", `/api/link/${tokenA}`);
  const loc = legacy.headers.get("location") ?? "";
  check(legacy.status === 303 && loc.endsWith(`/garden#k=${tokenA}`) && !legacy.headers.get("set-cookie"),
    "the old GET /api/link/<token> only redirects to the fragment form: no session, no side effects", `status ${legacy.status}`);
  const unknown = await call("POST", "/api/session", { body: { token: "x".repeat(43) } });
  check(unknown.status === 404 && unknown.json?.error === "link_invalid", "an unknown link is a calm 404");
  const cut = await call("POST", "/api/session", { body: { token: tokenA.slice(0, 40) } });
  check(cut.status === 400 && cut.json?.error === "link_incomplete", "a cut-off link is a 400 that says so");

  // 8. the practice-copy guard: a dev server may not tend a real plant. A production server without the rehearsal flag
  // hides practice plants and refuses to plant before the opening hour.
  if (!PRODUCTION) {
    await sql`update meadow.plants set rehearsal = false where plot_index = ${plotB}`;
    const sprReal = await call("POST", "/api/sprinkle", { jar: a, body: { plot: plotB, clientEventId: randomUUID() } });
    const careReal = await call("POST", "/api/care", { jar: b, body: { kind: "talk", clientEventId: randomUUID() } });
    await sql`update meadow.plants set rehearsal = true where plot_index = ${plotB}`;
    check(sprReal.status === 409 && sprReal.json?.error === "practice_only" && careReal.status === 409 && careReal.json?.error === "practice_only",
      "a non-production server refuses to sprinkle or tend a real plant", sprReal.json?.message);
  }
  if (STRICT_BASE) {
    const strictMeadow = await call("GET", "/api/meadow", { base: STRICT_BASE });
    const shown = (strictMeadow.json?.plots ?? []).filter((p) => p.plot === plotA || p.plot === plotB).length;
    check(strictMeadow.status === 200 && shown === 0, "production without MEADOW_REHEARSAL hides rehearsal plants from the Meadow",
      `status ${strictMeadow.status}, count ${strictMeadow.json?.count}`);
    const strictSeed = await call("POST", "/api/seed", { base: STRICT_BASE, body: withCode({ firstName: TEST_NAME, species: "rose", clientEventId: randomUUID() }) });
    check(strictSeed.status === 409 && strictSeed.json?.error === "not_yet", "production without MEADOW_REHEARSAL refuses to plant before the opening hour", strictSeed.json?.message);
  }

  // 9. "someone else has my link", and signing out
  const reset = await call("POST", "/api/session/reset", { jar: a, body: {} });
  const newToken = linkToken(reset.json?.link);
  check(reset.status === 200 && TOKEN_RE.test(newToken) && newToken !== tokenA && reset.json?.signedOut >= 1 && reset.json?.linksRevoked >= 1,
    "POST /api/session/reset revokes the other devices and links and returns a fresh link", `signed out ${reset.json?.signedOut}, links revoked ${reset.json?.linksRevoked}`);
  const laptopGone = await call("GET", "/api/me", { jar: laptop });
  const oldLink = await call("POST", "/api/session", { body: { token: tokenA } });
  const stillA = await call("GET", "/api/me", { jar: a });
  check(laptopGone.status === 401 && oldLink.status === 404 && stillA.status === 200, "the laptop is signed out, the old link is dead, this device keeps its garden");
  const end = await call("POST", "/api/session/end", { jar: b, body: {} });
  const meEnded = await call("GET", "/api/me", { jar: b });
  check(end.status === 200 && end.json?.status === "signed_out" && !b.has("meadow_session") && meEnded.status === 401,
    "POST /api/session/end signs the device out and clears its cookie", `ended ${end.json?.ended}`);
  const notJsonEnd = await call("POST", "/api/session/end", { jar: a, raw: "", headers: { "content-type": "text/plain" } });
  check(notJsonEnd.status === 415, "session changes need a JSON body (so cross-site forms cannot sign anyone out)");
  const formLink = await call("POST", "/api/link", { jar: a, raw: "x=1", headers: { "content-type": "application/x-www-form-urlencoded" } });
  check(formLink.status === 415, "POST /api/link needs a JSON body too (a cross-site form cannot mint a link)", `status ${formLink.status}`);

  // the hourly cap on new garden links (planting, retries and the reset above made a few already)
  const linkStatuses = [];
  for (let i = 0; i < 12; i++) {
    const r = await call("POST", "/api/link", { jar: a, body: {} });
    linkStatuses.push(r.status === 429 ? r.json?.error : r.status);
    if (r.status !== 200) break;
  }
  const [{ n: linksMade }] = await sql`
    select count(*)::int as n from meadow.garden_links l
    join meadow.gardens g on g.person_id = l.person_id
    join meadow.plants p on p.garden_id = g.id
    where p.plot_index = ${plotA} and l.created_at > now() - interval '1 hour'`;
  check(linkStatuses[0] === 200 && linkStatuses.at(-1) === "too_many_links" && linksMade <= 10,
    "POST /api/link makes fresh links, then asks to wait once a person has made ten in an hour", `${linkStatuses.join(",")}; ${linksMade} made`);

  // 10. weather and input hygiene
  const weather = await call("GET", "/api/weather/now");
  check(weather.status === 200 && typeof weather.json?.temperatureC === "number" && typeof weather.json?.lagHours === "number", "GET /api/weather/now",
    `${weather.json?.temperatureC} C, ${weather.json?.humidityPct}% RH, rain ${weather.json?.rainMm} mm, hour from ${weather.json?.from}, lagHours ${weather.json?.lagHours}`);
  const notJson = await call("POST", "/api/care", { jar: a, raw: "kind=water", headers: { "content-type": "application/x-www-form-urlencoded" } });
  check(notJson.status === 415, "a non-JSON body is refused with 415");
  const brokenJson = await call("POST", "/api/care", { jar: a, raw: "{nope", headers: { "content-type": "application/json" } });
  check(brokenJson.status === 400 && brokenJson.json?.error === "bad_json", "malformed JSON is a 400");
}

async function main() {
  console.log(`smoke test against ${BASE} (expecting ${PRODUCTION ? "production" : "development"} behaviour${STRICT_BASE ? `; strict production at ${STRICT_BASE}` : ""})`);
  const sql = connect("POSTGRES_URL_NON_POOLING");
  try {
    const [{ started }] = await sql`select now() as started`;
    // leftovers from an interrupted earlier run would skew the before/after comparison
    const stale = await sql`delete from meadow.people where first_name = ${TEST_NAME} returning id`;
    if (stale.length > 0) console.log(`removed ${stale.length} test people left by an earlier run`);
    const before = await counts(sql);
    try {
      await run(sql);
    } finally {
      // cleanup runs even when a step failed
      const removed = await sql`delete from meadow.people where first_name = ${TEST_NAME} returning id`;
      console.log(`cleanup: removed ${removed.length} test people (with their gardens, plants, events, checkpoints, sprinkles, sessions, links)`);
      // a production-mode run stores the weather it fetched; only pre-game hours (h < 0), which no real plant needs
      const wx = await sql`delete from meadow.weather_hours where h < 0 and fetched_at >= ${started} returning h`;
      if (wx.length > 0) console.log(`cleanup: removed ${wx.length} pre-game weather hours this run stored`);
      const after = await counts(sql);
      check(after.test_people === 0, "no test people remain");
      const keys = ["people", "plants", "events", "sessions", "links", "sprinkles", "checkpoints", "weather"];
      check(keys.every((k) => after[k] === before[k]), "row counts are back to where they started", JSON.stringify(after));
    }
  } finally {
    await sql.end();
  }
  console.log(failures === 0 ? "\nSMOKE PASSED" : `\nSMOKE FAILED: ${failures} check(s)`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(`smoke test crashed: ${err.message}`);
  process.exitCode = 1;
});
