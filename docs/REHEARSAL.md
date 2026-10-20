# Party week rehearsal

A calm checklist for the week before the party on Tuesday 10 November 2026, which starts at 15:00 IST. Work through
it in order. Each step says what you should see; if something looks different, stop there and ask for help. Nothing
later depends on rushing.

The live site is https://meadow-phi.vercel.app. Its settings are in Vercel, in the **meadow** project.

## Before you start

- Open a terminal in the project folder: in File Explorer, open `D:\Lijas\code\Claude\Disney Garden`, right-click an
  empty space and choose **Open in Terminal**. Type each command below there, one at a time.
- Check that `.env.local` is in that folder. It holds the database keys the scripts use. Never open it on a shared
  screen.
- Check that the latest code is live: in Vercel, under **Deployments**, the newest Production deployment says **Ready**
  and matches the latest commit on GitHub.
- Keep secrets out of chat, email, screenshots and this file: the party code, anything starting with `postgres`, and
  anything inside a `.env` file. Where a command below says `<party code>`, type your code in its place.

Suggested days: steps 1 and 2 on Monday 2 November, steps 3 and 4 on Tuesday 3 or Wednesday 4, step 5 on Thursday 5,
and Monday 9 November as a quiet spare day.

Planting is already open on the live site for anyone with the party link, from 20 October until 10 December. Every
planting is a real garden: it keeps growing through the party, may bloom before it, and stays. So the colleagues who
test it now keep their gardens, and the Meadow will already hold a few flowers when the party starts. Names are unique
in the Meadow, so each person plants once, under their own name.

## 1. Make the party code

The party code opens planting. The QR code on the party screen carries it, and without it no one can plant. It is not
a password, since the link is meant to be shared at the party, but keep it to yourself until then.

1. Make a code: 10 lower-case letters and digits, leaving out ones that are easy to confuse.
   ```
   node -e "const a='abcdefghjkmnpqrstuvwxyz23456789',c=require('node:crypto');console.log(Array.from({length:10},()=>a[c.randomInt(a.length)]).join(''))"
   ```
2. Copy it into a private note or a password manager. It is case sensitive.
3. In Vercel, open **meadow > Settings > Environment Variables** and add a variable named `MEADOW_PARTY_CODE`. Its value
   is the code, and its environment is **Production** only. Save.
4. Redeploy so the site picks it up: under **Deployments**, open the newest Production deployment's menu (the three
   dots), choose **Redeploy**, and wait for **Ready**. Every change to a variable needs a redeploy like this.
5. Check it: open `https://meadow-phi.vercel.app/party?code=<party code>`. The panel says "A gift for you" and shows
   a QR code, with the link written underneath it. Scan it with your phone. The phone offers **Receive your seed**.
   Stop there unless you want a garden of your own: anything planted is a real garden that stays.

To change the code later without a gap: set the variable to `newcode,oldcode`, redeploy, and open the party screen
with the new code. Once no one needs the old link, set it to `newcode` alone and redeploy again.

Preview deployments need no code, because they only ever plant practice seeds.

## 2. Give the app its own limited login

Today the live site connects to the database with the main account, which can do anything. This step gives the site
its own login, `meadow_app`, which can read and add but can never delete anything or change how the database is built.
The scripts keep using the main account from `.env.local`.

1. Check where things stand:
   ```
   node --env-file=.env.local scripts/app-role.mjs --status
   ```
   You should see `meadow_app exists: login=false bypassrls=false`.
2. Turn the login on. Run this once only: running it again changes the password, and the site cannot reach the
   database until Vercel has the new one.
   ```
   node --env-file=.env.local scripts/app-role.mjs --enable
   ```
   It says `meadow_app can now log in. Its pooler URL is in .env.meadow-app.local (not printed).` The new login's
   address is now in a local helper file, `.env.meadow-app.local`. The script also points your local development
   server at the new login from its next restart, through `.env.development.local`. Keep that second file; it is
   private and is never committed.
3. Test the new login:
   ```
   node --env-file=.env.meadow-app.local scripts/app-role.mjs --test
   ```
   You should see `connected through the pooler as meadow_app` and then `ok: DELETE is refused (42501)`.
4. Copy the address. Run `notepad .env.meadow-app.local` and copy everything after `MEADOW_APP_POSTGRES_URL=` on that
   line, up to the end of the line. It starts with `postgres`. Close Notepad without saving.
5. Put it on Vercel for **Production** and **Preview**, in **meadow > Settings > Environment Variables**:
   - If you can edit `POSTGRES_URL` there, paste the address as its value for Production and Preview, and save. Leave
     Development as it is.
   - If you can't edit it because it belongs to the Supabase integration (today all the database variables come from
     it), first open the **Storage** tab, open the Supabase database, and in its settings for the meadow project change
     its environments to **Development** only. Its variables then leave Production and Preview. That also removes the
     main account's other keys, which the site never needs. Then go back to **Environment Variables** and add a
     variable named `POSTGRES_URL`. Its value is the pasted address, its environments are **Production** and
     **Preview**, and it is marked **Sensitive**. Save.
   - Either way, if `POSTGRES_URL_NON_POOLING` is still listed for Production or Preview, remove it from those two.
     The scripts read it from `.env.local`, not from Vercel.
6. Redeploy Production, as in step 1.4, and wait for **Ready**.
7. Check the site: `https://meadow-phi.vercel.app/meadow` opens and the Meadow appears. If it keeps asking you to try
   again, check that the value you pasted is the whole line with no space at either end, then redeploy. The
   smoke test in step 3 is the full test.
8. Check the database is still private:
   ```
   node --env-file=.env.local scripts/verify-db.mjs
   ```
   The last line says `RESULT: meadow is private`.
9. Delete the local helper file, since Vercel now holds the address:
   ```
   Remove-Item .env.meadow-app.local
   ```
   Then `Test-Path .env.meadow-app.local` should answer `False`.
10. If the local development server is running, restart it. It now connects as `meadow_app`.

## 3. Smoke test on the live site

The smoke test tries every part of the service against the live site, with the same code, the same database and the
same Production deployment that will serve the party.

1. Run the production smoke test. It plants two test seeds, "Test Seed (delete me)" and "Test Seed B (delete me)", and
   tries every part of the service: planting, unique names, care, sprinkles, the Meadow, garden links and the weather.
   The two test gardens show in the live Meadow and on the party screen's feed for the few minutes it runs, then it
   deletes everything it made. Type these four lines:
   ```
   $env:SMOKE_BASE_URL = "https://meadow-phi.vercel.app"
   $env:SMOKE_EXPECT = "production"
   $env:SMOKE_PARTY_CODE = "<party code>"
   node --env-file=.env.local scripts/smoke-api.mjs
   ```
   It takes a few minutes. Each check line starts with `ok`, the `cleanup:` lines say what was removed, and the last
   line is `SMOKE PASSED`. A `note:` line about other activity just means colleagues were using the site meanwhile. If
   the only `FAIL` lines are the three about the weather ahead (the forecast, `rainSoon` and the cache line), the free
   weather service was probably busy for a moment: wait ten minutes and run the last line again. If anything else says
   `FAIL`, keep the output (it never prints secrets) and stop here.
   Afterwards, close this terminal window so it forgets those settings, and open a fresh one.
2. Check for test gardens left by a development or preview server (they share the database, but never show on the live
   site):
   ```
   node --env-file=.env.local scripts/clear-rehearsals.mjs
   ```
   It lists them, says how many real plants it keeps, and ends with `dry run: nothing deleted`. If it lists any, delete
   them with `--yes` at the end of the same line. Run it again: it should say `rehearsal gardens: 0`.

## 4. Real phones with colleagues

Ask a few colleagues to try it on their own phones. Aim for a mix: an iPhone and an Android phone, one on office Wi-Fi
and one on mobile data, and a laptop or iPad for the personal link. Their gardens are real and keep growing, so ask the
people who would plant anyway.

1. Open the party screen on a laptop, `https://meadow-phi.vercel.app/party?code=<party code>`, so everyone can watch
   the feed.
2. Send each colleague this link privately, not in the team chat:
   `https://meadow-phi.vercel.app/garden?code=<party code>`
   (Scanning the QR code on the party screen works just as well.)
3. Each colleague, in turn, receives the seed, types their first name, chooses a flower and plants it. They should see
   the planting moment and then the link sheet. Their name appears in the party screen's feed. Try a name someone
   already used, in other capitals too: the name step should ask for an initial or a nickname, like "Asha K", before
   the seeds appear.
4. In their garden, each one waters once and looks at the care panel and the weather line. Then they open the Meadow
   (`https://meadow-phi.vercel.app/meadow`), find a colleague with **Find a friend**, visit and sprinkle.
5. Open the personal garden link from the link sheet on a laptop or iPad. The same garden appears there.
6. Ask each person whether anything was confusing, slow, hard to read or cut off, and whether the page felt smooth.
   Note their phone and browser beside each answer.

A phone keeps the garden it planted: scanning again opens that garden, not the gift. Ask people to scan with the
phone's camera, not from inside WhatsApp or Teams, today and on the day. An app's own browser keeps a separate memory,
so the same person can end up with two gardens (see "After the party").

## 5. Venue check on the real laptop and screen

Use the laptop that will drive the venue screen, connected to that screen, on the network you will use on the day.

1. Plug the laptop into power and turn battery saver off. Close other apps and browser tabs, and turn on **Do not
   disturb** so no notifications appear on the big screen.
2. Use Chrome or Edge. Press Windows + P and choose **Second screen only**, or **Duplicate** if you also want to see it
   on the laptop.
3. Open `https://meadow-phi.vercel.app/party?code=<party code>` and press **F** for full screen.
4. Time how long it takes to open. A soft veil shows "Gathering the seeds", "Unfurling the petals" and "Letting the
   light in", and then Lijas's Enchanted Rose garden appears at golden hour. The gift panel with the QR code appears
   within 30 seconds at the latest, even if the garden is still settling.
5. Scan the QR code from the back of the room with two phones, one on Wi-Fi and one on mobile data. Both should open
   the gift, "A seed, just for you", with **Receive your seed**. Stop there: anything planted is a real garden. Check
   that the link under the QR code can be read from the back.
6. Leave it running for 15 minutes. The view moves slowly by itself, the pointer hides when the mouse rests, and the
   laptop should not sleep or dim.
7. Keys, if you need them: **H** hides or shows the panel, **T** starts or stops a slow tour, and **F** switches full
   screen.

If loading is slow, or the motion is jerky:

- Wait. The QR code appears within 30 seconds whatever happens, and people can plant from it.
- Reload once. The second opening is quicker, because the browser has kept the files and the laptop remembers the
  look it settled on.
- Check the power, battery saver and other apps again (step 5.1).
- Add `&quality=balanced` to the end of the address for a lighter look, or `&quality=lite` for the lightest. Note
  which looks best and use that address on the day.
- If the screen is 4K, try setting it to 1920 x 1080 in Windows display settings.
- If the 3D garden can't start at all, the page shows the gift panel on its own on a quiet background, with the QR
  code. Planting works just the same.

Write the final address, with any `&quality=` ending, in your private note.

## 6. Party day run sheet (Tuesday 10 November)

**In the morning**

1. In Vercel, check that `MEADOW_PARTY_CODE` is set for Production and the newest Production deployment says
   **Ready**.
2. Check that no test gardens from a development or preview server are left:
   ```
   node --env-file=.env.local scripts/clear-rehearsals.mjs
   ```
   It should say `rehearsal gardens: 0`. If any are listed, clear them, because their names stay taken while they are
   there (the live Meadow never shows them). The list only ever holds test gardens; colleagues' gardens are counted
   under `real plants (kept)`. From 10 November the script asks for both `--yes` and `--force`:
   ```
   node --env-file=.env.local scripts/clear-rehearsals.mjs --yes --force
   ```

**At 14:30**

3. Plug the laptop into power, connect it to the screen and turn on **Do not disturb**. Open the address from your
   note (`/party?code=<party code>`, plus any `&quality=` ending) and press **F**. Let it open fully and leave it
   running.

**What people see**

- Anyone who scans sees "A seed, just for you" and can plant straight away; planting has been open since 20 October.
- They tap **Receive your seed** and type their first name, or choose "A friend" to keep it off the sign.
  Names are unique in the Meadow: if a colleague already has theirs, the name step asks them to add an initial or a
  nickname, like "Asha K". Then they choose one of seven flowers and tap **Plant the** and the flower's name. The seed
  settles into its bed (a lotus into a glass of water by its pond), the
  link sheet offers a personal link for a laptop or iPad, and their own garden opens.
- On the big screen the count goes up and names glide into the feed, like "Priya planted a Night Jasmine". Their
  sprouts appear in the Meadow. The count starts from the gardens already planted before the party, and some of those
  may be in bloom.

**If planting is busy**

- Phones say "Lots of seeds are going in at once. Yours will follow in a moment." and keep trying by themselves for up
  to three minutes. Ask people to keep the page open; there is no need to tap again, scan again or switch apps.
- If a phone then says "The garden is very busy just now. Your seed is safe in your hand; please try again in a
  minute.", they wait a minute and tap to try again. Their name and flower are kept, and a seed is never planted
  twice.
- If the room is very full, invite people one table at a time.
- If phones say "Seed planting is still being set up", `MEADOW_PARTY_CODE` is missing on Production. Add it (step 1.3)
  and redeploy; planting opens a couple of minutes later.
- If phones say "That party link looks out of date", the code in the screen's address doesn't match the one on Vercel.
  Retype the address from your note.

**If a name needs to come down**

1. Find the person's plot:
   ```
   node --env-file=.env.local scripts/hide-name.mjs --name "Asha"
   ```
2. Hide the name on that plot (12 here is only an example):
   ```
   node --env-file=.env.local scripts/hide-name.mjs --plot 12 --hide
   ```
   Within about ten seconds the sign and the feed show "A friend". `--show` in place of `--hide` puts the name back.

**After the party**

- Colleagues who missed it can plant until 10 December with the same link,
  `https://meadow-phi.vercel.app/garden?code=<party code>`. Share it in the team chat once the party has started, and
  keep `MEADOW_PARTY_CODE` set until then.
- A day or two later, look for anyone who planted twice, from a second phone or a link opened inside WhatsApp or Teams.
  Their second garden carries a variant of their name ("Asha" and "Asha K"), so the script groups names by their first
  word:
  ```
  node --env-file=.env.local scripts/find-duplicates.mjs
  ```
  It only lists them. Ask the person which garden they use before removing anything.
