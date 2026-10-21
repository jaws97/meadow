// Tells Bing, and the other search engines that share IndexNow (Yandex, Seznam, Naver), which of the site's pages to
// visit, so a new or changed page is crawled within days instead of whenever a crawler happens by. It reads the live
// sitemap and submits its addresses with the site's IndexNow key, which the site serves as public/<key>.txt so the
// search engine can tell the request comes from the site itself. Google takes no part in IndexNow; it reads the sitemap
// through Search Console instead. The key is public by design, so nothing here is secret.
//
//   node scripts/indexnow.mjs                      every page in the live sitemap
//   node scripts/indexnow.mjs /garden /meadow      just these pages
//
// Run it after a change worth crawling again (the words, the address). An answer of 200 or 202 means the pages were
// taken; 202 says the key is still being checked, which happens on the first submission.
import { readdirSync } from "node:fs";
import { ensureTypeScript, importProject } from "./lib/load-sim.mjs";

ensureTypeScript();
const { PUBLIC_ORIGIN } = await importProject("lib/origin.ts");

const keyFile = readdirSync(new URL("../public/", import.meta.url)).find((f) => /^[0-9a-f]{32}\.txt$/.test(f));
if (!keyFile) {
  console.error("no IndexNow key file in public/ (32 hex characters, .txt, holding the same characters)");
  process.exit(1);
}
const key = keyFile.slice(0, -4);
const keyLocation = `${PUBLIC_ORIGIN}/${keyFile}`;

// the live site must serve the key before a search engine will take the pages
const served = await fetch(keyLocation).then((r) => (r.ok ? r.text() : null)).catch(() => null);
if (served?.trim() !== key) {
  console.error(`${keyLocation} does not serve the key yet; deploy the site first`);
  process.exit(1);
}

const paths = process.argv.slice(2);
const urlList = paths.length
  ? paths.map((p) => new URL(p, PUBLIC_ORIGIN).href)
  : [...(await fetch(`${PUBLIC_ORIGIN}/sitemap.xml`).then((r) => r.text())).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

const res = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "content-type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host: new URL(PUBLIC_ORIGIN).host, key, keyLocation, urlList }),
});
console.log(`IndexNow answered ${res.status} for ${urlList.length} page(s): ${urlList.join(", ")}`);
if (res.status !== 200 && res.status !== 202) {
  console.error(await res.text());
  process.exit(1);
}
