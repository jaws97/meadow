// End-to-end smoke test of the real API against a running server (default http://localhost:3000, or SMOKE_BASE_URL).
// Plants two test seeds, "Test Seed (delete me)" and "Test Seed B (delete me)" (names are unique in the Meadow), and
// walks the API: retries, unique names, care and its limits, sprinkles, the Meadow, a catch-up across completed hours, personal garden links opened on other devices (sign in, the switch prompt,
// switch back, reset, sign out), the practice-copy guard and the weather (the hour just completed, the next 24 hours of
// forecast and the heavy-rain hint, none of it stored as weather rows); then DELETES every row it created (people
// cascade to their gardens, plants, events, checkpoints, sprinkles, sessions and links) and checks that nothing is left.
//
//   node --env-file=.env.local scripts/smoke-api.mjs
//
// Against the local dev server, which is not the production deployment (lib/server/env.ts): plantings are marked as
// rehearsals, and the server must write no checkpoint and no weather row; the test checks both.
//
// SMOKE_EXPECT=production runs it against a production-mode server instead (a local `next build && next start`, or the
// Production deployment): its two test seeds are real gardens for the few minutes the run takes (they show in the live
// Meadow and the party screen's feed until the cleanup), and it expects the Secure cookie, catch-ups saved as
// checkpoints (single and bulk), and weather rows written once. Before 10 Nov the cleanup also removes the pre-game
// weather hours the run wrote, unless a colleague's garden planted before 10 Nov needs them.
//
// SMOKE_PARTY_CODE (or the first code in MEADOW_PARTY_CODE) is sent with every planting, so the test's seeds never wait
// behind the limits on strangers' plantings; when one is known the test also checks that a planting with an old one is
// refused, and that the name check answers without it (anyone may plant).
//
// The database is only used for setup tweaks, the cleanup and the before/after counts (POSTGRES_URL_NON_POOLING).
// Tokens, cookies, garden links and the party code are never printed.
import { randomUUID } from "node:crypto";
import { connect } from "./db-connect.mjs";

const BASE = (process.env.SMOKE_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const PRODUCTION = process.env.SMOKE_EXPECT === "production";
const PARTY_CODE = process.env.SMOKE_PARTY_CODE || (process.env.MEADOW_PARTY_CODE ?? "").split(",")[0].trim() || null;
const withCode = (body) => (PARTY_CODE ? { ...body, partyCode: PARTY_CODE } : body);
const TEST_NAME = "Test Seed (delete me)";
const TEST_NAME_B = "Test Seed B (delete me)";
/** every name this test plants under, lower-cased as the unique index compares them, so the cleanup and the counts
 * find them all (and a planting that wrongly went in under another case) */
const TEST_KEYS = [TEST_NAME, TEST_NAME_B].map((n) => n.toLowerCase());
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
           (select count(*)::int from meadow.people where lower(first_name) = any(${TEST_KEYS})) as test_people`;
  return r;
}

async function run(sql) {
  const a = new Jar(), b = new Jar();

  // 1. plant, and retries
  const seedId = randomUUID();
  if (PARTY_CODE) {
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
  check(seed.json.me.plant.rehearsal === !PRODUCTION,
    PRODUCTION ? "a planting on the live site is a real garden (not a rehearsal)" : "a planting through the dev server is marked as a rehearsal",
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

  // 1b. unique names: the name step's question, and a planting under a name already in the Meadow (in another case)
  const sameNameOtherCase = TEST_NAME.toUpperCase();
  const asked = await call("POST", "/api/name", { body: withCode({ firstName: `  ${sameNameOtherCase} ` }) });
  check(asked.status === 200 && asked.json?.available === false && typeof asked.json?.message === "string" && asked.json?.firstName === sameNameOtherCase,
    "POST /api/name says a name already in the Meadow (in any case) is taken, with words for the name step", asked.json?.message);
  const free = await call("POST", "/api/name", { body: withCode({ firstName: TEST_NAME_B }) });
  check(free.status === 200 && free.json?.available === true && free.json?.message === null, "POST /api/name says a free name is free");
  const ownLost = await call("POST", "/api/name", { body: withCode({ firstName: TEST_NAME, clientEventId: seedId }) });
  check(ownLost.status === 200 && ownLost.json?.available === true,
    "POST /api/name does not count the asker's own planting (an answer lost on the way), so planting again can return it");
  const badName = await call("POST", "/api/name", { body: withCode({ firstName: "   " }) });
  check(badName.status === 400 && badName.json?.field === "firstName", "POST /api/name checks the name as planting does", badName.json?.error);
  // an offensive word (kept in ROT13, as lib/server/unkind.ts keeps its lists)
  const rot13 = (s) => s.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97));
  const unkind = await call("POST", "/api/name", { body: withCode({ firstName: `Test ${rot13("phag")}` }) });
  check(unkind.status === 400 && unkind.json?.error === "name_unkind" && unkind.json?.field === "firstName",
    "POST /api/name keeps an offensive word off the garden signs", unkind.json?.error);
  if (PARTY_CODE) {
    const askNoCode = await call("POST", "/api/name", { body: { firstName: TEST_NAME_B } });
    check(askNoCode.status === 200 && typeof askNoCode.json?.available === "boolean", "POST /api/name answers without the party code too: anyone may plant",
      `status ${askNoCode.status} ${askNoCode.json?.error ?? ""}`);
  }
  const clash = await call("POST", "/api/seed", { body: withCode({ firstName: sameNameOtherCase, species: "rose", clientEventId: randomUUID() }) });
  check(clash.status === 409 && clash.json?.error === "name_taken" && clash.json?.field === "firstName",
    "a planting under a name already in the Meadow (in another case) is declined kindly, pointing at the name", clash.json?.message);

  // 2. care
  const waterId = randomUUID();
  const water = await call("POST", "/api/care", { jar: a, body: { kind: "water", clientEventId: waterId } });
  check(water.status === 200 && water.json?.event?.duplicate === false, "POST /api/care water records a can", `status ${water.status} ${water.json?.message ?? ""}`);
  check(water.json?.me?.pending?.some((e) => e.kind === "water"), "the can shows as pending until the hour completes");
  check(water.json?.me?.care?.shade === false && water.json?.me?.care?.shadeSinceH === null, "care.shadeSinceH is null while the shade cloth is off");
  const retry = await call("POST", "/api/care", { jar: a, body: { kind: "water", clientEventId: waterId } });
  check(retry.status === 200 && retry.json?.event?.duplicate === true, "retrying the same clientEventId is idempotent");
  const soon = await call("POST", "/api/care", { jar: a, body: { kind: "water", clientEventId: randomUUID() } });
  check(soon.status === 429 && soon.json?.error === "too_soon" && typeof soon.json?.retryAt === "string", "a second can within 4 hours is declined with retryAt", soon.json?.message);
  const shade = await call("POST", "/api/care", { jar: a, body: { kind: "shade", on: true, clientEventId: randomUUID() } });
  check(shade.status === 200 && shade.json?.me?.care?.shade === true, "the shade cloth goes on");
  const shadeH = shade.json?.event?.h;
  check(Number.isInteger(shadeH) && shade.json?.me?.care?.shadeSinceH === shadeH, "care.shadeSinceH is the hour the shade cloth went on",
    `shadeSinceH ${shade.json?.me?.care?.shadeSinceH}, event h ${shadeH}`);
  const [{ n: eventsBefore }] = await sql`select count(*)::int as n from meadow.plant_events e join meadow.plants p on p.id = e.plant_id where p.plot_index = ${plotA}`;
  const shadeAgain = await call("POST", "/api/care", { jar: a, body: { kind: "shade", on: true, clientEventId: randomUUID() } });
  const [{ n: eventsAfter }] = await sql`select count(*)::int as n from meadow.plant_events e join meadow.plants p on p.id = e.plant_id where p.plot_index = ${plotA}`;
  check(shadeAgain.status === 200 && shadeAgain.json?.event?.unchanged === true && eventsAfter === eventsBefore, "shade on when it is already on records nothing", `events ${eventsBefore} -> ${eventsAfter}`);
  check(shadeAgain.json?.me?.care?.shadeSinceH === shadeH, "and keeps the hour it first went on");
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
  check(me.json?.care?.shade === true && me.json?.care?.shadeSinceH === shadeH, "GET /api/me says when the shade cloth went on", `shadeSinceH ${me.json?.care?.shadeSinceH}`);
  const anon = await call("GET", "/api/me");
  check(anon.status === 401 && anon.json?.error === "no_session", "GET /api/me without a session is a calm 401");

  // 4. a friend sprinkles
  const seedB = await call("POST", "/api/seed", { jar: b, body: withCode({ firstName: TEST_NAME_B, species: "jasmine", showName: false, clientEventId: randomUUID() }) });
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
    `GET /api/meadow lists both plants (${PRODUCTION ? "real gardens" : "a dev server shows its rehearsals"})`, `count ${meadow.json?.count}, plot ${plotA}: ${pa?.species}/${pa?.stage}/${pa?.health}/bloom ${pa?.bloom}`);
  const etag = meadow.headers.get("etag");
  check(Boolean(etag) && /s-maxage=5\b/.test(meadow.headers.get("cache-control") ?? "") && !meadow.headers.get("set-cookie"),
    "the snapshot has an ETag, s-maxage=5 and no cookie", meadow.headers.get("cache-control"));
  const notModified = await call("GET", "/api/meadow", { headers: { "if-none-match": etag } });
  check(notModified.status === 304, "If-None-Match gets a 304", `status ${notModified.status}`);

  // 6. catch-up across completed hours: backdate both plantings by six hours and mark their checkpoints as written by
  // another model version, so the server must rebuild them from planting with real weather. A dev server must compute
  // the plants without saving a checkpoint or writing a weather row; a production server must save both catch-ups (the
  // single one from GET /api/me, the bulk one from the Meadow) and write the weather hours once.
  //
  // The shared database is busy while colleagues practise on the live site, so the weather is judged only in the hours
  // the backdated test plants need, [their planting hour, the hour just completed), leaving out the hour just completed
  // (Open-Meteo may not have published it yet): rows there stored from this moment on, and rows missing there.
  const [{ t: wxSince }] = await sql`select now() as t`;
  const backdate = async (plot) => {
    const [p] = await sql`
      update meadow.plants set planted_h = planted_h - 6 where plot_index = ${plot}
        and garden_id in (select g.id from meadow.gardens g join meadow.people pe on pe.id = g.person_id where lower(pe.first_name) = any(${TEST_KEYS}))
      returning id, planted_h`;
    await sql`update meadow.checkpoints set sim_version = 0 where plant_id = ${p.id}`;
    return p.planted_h;
  };
  const wxLo = Math.min(await backdate(plotA), await backdate(plotB));
  const testWeather = async (hi, since) => {
    const [r] = await sql`
      select count(*)::int as stored, (count(*) filter (where fetched_at >= ${since}))::int as fresh
      from meadow.weather_hours where h >= ${wxLo} and h < ${hi}`;
    return r;
  };
  const caught = await call("GET", "/api/me", { jar: a });
  const st = caught.json?.state, now = caught.json?.now, wxs = caught.json?.weather;
  // Open-Meteo may not have published the hour that has only just completed; anything older must be there
  const caughtUp = st?.h === now?.h || (wxs?.upToDate === false && wxs?.waitingFromH === now?.h - 1 && st?.h === now?.h - 1);
  check(caught.status === 200 && caughtUp && st?.h > now?.h - 6,
    "GET /api/me rebuilds a plant six hours behind from its events and real weather",
    `state h ${st?.h}, now h ${now?.h}, weather upToDate ${wxs?.upToDate}, moisture ${caught.json?.visual?.moisture?.toFixed?.(2)}`);
  check(caught.json?.pending?.some((e) => e.kind === "water"), "this hour's can is still pending after the rebuild");
  check(caught.json?.care?.shadeSinceH === shadeH, "the shade cloth's hour survives the rebuild", `shadeSinceH ${caught.json?.care?.shadeSinceH}`);
  const shadeOff = await call("POST", "/api/care", { jar: a, body: { kind: "shade", on: false, clientEventId: randomUUID() } });
  check(shadeOff.status === 200 && shadeOff.json?.me?.care?.shade === false && shadeOff.json?.me?.care?.shadeSinceH === null,
    "the shade cloth comes off and care.shadeSinceH is null again", `status ${shadeOff.status} ${shadeOff.json?.message ?? ""}`);
  await new Promise((r) => setTimeout(r, 5_000)); // past the Meadow's few-second reuse window
  const meadow2 = await call("GET", "/api/meadow");
  check(meadow2.status === 200 && meadow2.json?.plots?.some((p) => p.plot === plotB), "GET /api/meadow catches every plant up in one pass");
  const cps = await sql`
    select c.sim_version, c.h, p.planted_h from meadow.checkpoints c join meadow.plants p on p.id = c.plant_id
    join meadow.gardens g on g.id = p.garden_id join meadow.people pe on pe.id = g.person_id
    where lower(pe.first_name) = any(${TEST_KEYS})`;
  const wxHi = (now?.h ?? wxLo) - 1;
  const wx = await testWeather(wxHi, wxSince);
  if (PRODUCTION) {
    check(cps.length === 2 && cps.every((c) => c.sim_version > 0 && c.h > c.planted_h),
      "production saved both catch-ups as checkpoints (GET /api/me's and the Meadow's bulk update)", JSON.stringify(cps));
    check(wx.stored === wxHi - wxLo, "the shared weather store holds every hour the test plants needed (production stores what it fetches)",
      `${wx.stored} of ${wxHi - wxLo} hours from h ${wxLo}`);
    const [{ t: thirdSince }] = await sql`select now() as t`;
    await call("GET", "/api/me", { jar: a });
    const again = await testWeather(wxHi, thirdSince);
    check(again.fresh === 0, "a second visit writes no weather row again (each hour is stored once)", `${again.fresh} rows rewritten`);
  } else {
    check(cps.length === 2 && cps.every((c) => c.sim_version === 0), "the dev server saved no checkpoint (only production writes derived state)", JSON.stringify(cps));
    check(wx.fresh === 0, "the dev server wrote no weather row (it keeps fetched hours in memory)",
      `${wx.fresh} rows stored in the test's hours since the backdate; if the live site was catching up practice plants just then, run it again`);
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

  // 8. the practice-copy guard: a dev server may not tend a real plant
  if (!PRODUCTION) {
    await sql`update meadow.plants set rehearsal = false where plot_index = ${plotB}`;
    const sprReal = await call("POST", "/api/sprinkle", { jar: a, body: { plot: plotB, clientEventId: randomUUID() } });
    const careReal = await call("POST", "/api/care", { jar: b, body: { kind: "talk", clientEventId: randomUUID() } });
    await sql`update meadow.plants set rehearsal = true where plot_index = ${plotB}`;
    check(sprReal.status === 409 && sprReal.json?.error === "practice_only" && careReal.status === 409 && careReal.json?.error === "practice_only",
      "a non-production server refuses to sprinkle or tend a real plant", sprReal.json?.message);
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
  const wj = weather.json ?? {};
  const fc = Array.isArray(wj.forecast) ? wj.forecast : [];
  const shaped = fc.every((r) => Number.isInteger(r.h) && typeof r.temperatureC === "number" && typeof r.rainMm === "number" && r.rainMm >= 0
    && (r.cloudPct === null || (Number.isInteger(r.cloudPct) && r.cloudPct >= 0 && r.cloudPct <= 100)) && typeof r.sunWm2 === "number" && typeof r.isDay === "boolean");
  check(Number.isInteger(wj.nowH) && wj.nowH === wj.h + 1 + wj.lagHours && fc.length === 24 && fc.every((r, i) => r.h === wj.nowH + i) && shaped,
    "the weather carries the next 24 hours of forecast from the hour in progress",
    `nowH ${wj.nowH}, ${fc.length} hours from h ${fc[0]?.h}; first: ${fc[0]?.temperatureC} C, rain ${fc[0]?.rainMm} mm, cloud ${fc[0]?.cloudPct}%, sun ${fc[0]?.sunWm2} W/m2`);
  // the model's rainSoon over the next 12 hours, recomputed from the rows served
  const due = fc.filter((r) => r.h < wj.nowH + 12);
  const dueMm = Math.round(due.reduce((t, r) => t + r.rainMm, 0) * 10) / 10;
  const firstRain = due.find((r) => r.rainMm >= 0.1);
  const rs = wj.rainSoon;
  check(rs !== null && typeof rs?.heavy === "boolean" && Math.abs(rs.mm - dueMm) < 0.05 && rs.startsInH === (firstRain ? firstRain.h - wj.nowH : null),
    "rainSoon reads the next 12 forecast hours", `heavy ${rs?.heavy}, ${rs?.mm} mm, starts in ${rs?.startsInH} h`);
  check(/^public\b/.test(weather.headers.get("cache-control") ?? "") && /s-maxage=300\b/.test(weather.headers.get("cache-control") ?? "") && !weather.headers.get("set-cookie"),
    "the weather is the same for everyone, cached briefly by the CDN", weather.headers.get("cache-control"));
  const [{ n: storedAhead }] = await sql`select count(*)::int as n from meadow.weather_hours where h >= ${wj.nowH ?? 0}`;
  check(storedAhead === 0, "no forecast or unfinished hour is stored as a weather row", `${storedAhead} rows at or after h ${wj.nowH}`);
  const notJson = await call("POST", "/api/care", { jar: a, raw: "kind=water", headers: { "content-type": "application/x-www-form-urlencoded" } });
  check(notJson.status === 415, "a non-JSON body is refused with 415");
  const brokenJson = await call("POST", "/api/care", { jar: a, raw: "{nope", headers: { "content-type": "application/json" } });
  check(brokenJson.status === 400 && brokenJson.json?.error === "bad_json", "malformed JSON is a 400");
}

async function main() {
  console.log(`smoke test against ${BASE} (expecting ${PRODUCTION ? "production" : "development"} behaviour)`);
  const sql = connect("POSTGRES_URL_NON_POOLING");
  try {
    const [{ started }] = await sql`select now() as started`;
    // leftovers from an interrupted earlier run would skew the before/after comparison
    const stale = await sql`delete from meadow.people where lower(first_name) = any(${TEST_KEYS}) returning id`;
    if (stale.length > 0) console.log(`removed ${stale.length} test people left by an earlier run`);
    const before = await counts(sql);
    try {
      await run(sql);
    } finally {
      // cleanup runs even when a step failed
      const mine = await sql`
        select pe.id as person_id, p.id as plant_id from meadow.people pe
        left join meadow.gardens g on g.person_id = pe.id left join meadow.plants p on p.garden_id = g.id
        where lower(pe.first_name) = any(${TEST_KEYS})`;
      const removed = await sql`delete from meadow.people where lower(first_name) = any(${TEST_KEYS}) returning id`;
      console.log(`cleanup: removed ${removed.length} test people (with their gardens, plants, events, checkpoints, sprinkles, sessions, links)`);
      // a production-mode run stores the weather it fetched; its pre-game hours (h < 0) go too, unless a garden planted
      // before 10 Nov (a colleague's, from 20 Oct on) replays from them
      const [early] = await sql`select count(*)::int as n from meadow.plants where planted_h < 0`;
      const wx = early.n > 0 ? [] : await sql`delete from meadow.weather_hours where h < 0 and fetched_at >= ${started} returning h`;
      if (wx.length > 0) console.log(`cleanup: removed ${wx.length} pre-game weather hours this run stored`);
      if (early.n > 0) console.log(`cleanup: kept the pre-game weather hours (${early.n} gardens planted before 10 Nov replay from them)`);
      const after = await counts(sql);
      check(after.test_people === 0, "no test people remain");
      // everything the test made went with its people; counted by the test's own ids, since colleagues practising on the
      // live site may add rows of their own meanwhile
      const people = mine.map((r) => r.person_id), plants = mine.map((r) => r.plant_id).filter(Boolean);
      const [left] = await sql`
        select (select count(*)::int from meadow.people where id = any(${people}::uuid[])) as people,
               (select count(*)::int from meadow.gardens where person_id = any(${people}::uuid[])) as gardens,
               (select count(*)::int from meadow.plants where id = any(${plants}::uuid[])) as plants,
               (select count(*)::int from meadow.plant_events where plant_id = any(${plants}::uuid[])) as events,
               (select count(*)::int from meadow.checkpoints where plant_id = any(${plants}::uuid[])) as checkpoints,
               (select count(*)::int from meadow.sprinkles where giver_id = any(${people}::uuid[]) or plant_id = any(${plants}::uuid[])) as sprinkles,
               (select count(*)::int from meadow.sessions where person_id = any(${people}::uuid[])) as sessions,
               (select count(*)::int from meadow.garden_links where person_id = any(${people}::uuid[])) as links`;
      check(people.length === 2 && Object.values(left).every((n) => n === 0),
        "nothing the test made is left behind (gardens, plants, events, checkpoints, sprinkles, sessions, links)",
        `${people.length} test people; ${JSON.stringify(left)}`);
      const keys = ["people", "plants", "events", "sessions", "links", "sprinkles", "checkpoints", "weather"];
      const moved = keys.filter((k) => after[k] !== before[k]);
      if (moved.length > 0) {
        console.log(`note: other activity changed these totals during the run (colleagues practising on the live site, say): ${moved.map((k) => `${k} ${before[k]} -> ${after[k]}`).join(", ")}`);
      }
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
