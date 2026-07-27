# You Mode — App Store submission kit

Everything to paste into App Store Connect, in the order the form asks for it.

## App record
- **Platform:** iOS · **Bundle ID:** `com.youmode.app` · **SKU:** `youmode-ios-1`
- **Name:** You Mode
- **Subtitle** (30 chars max): `Custom goal challenges`
- **Category:** Health & Fitness (secondary: Lifestyle)
- **Price:** Free · **Age rating questionnaire:** all "None" → lands at 4+
- **Support URL:** https://youmode.app · **Privacy Policy URL:** https://youmode.app/privacy.html

## Description
> Stick to your goals.
>
> You Mode turns any goal into a daily challenge that fits your life. Tell it what you want to accomplish — out loud, in your own words — and it builds your checklist: workouts, meals, reading, meditation, anything.
>
> Track each item your way: snap a proof photo, tap a checkmark, or run a built-in timer that checks the item off when it finishes. Items can be daily, twice a day, a few times a week, or once a month — your goals, your rhythm.
>
> Go solo, or bring people in: head-to-head with a rival, an accountability partner, or a crew of up to 12 with a shared stake. Finished days count automatically on the honor system, with a quiet AI once-over on proof photos.
>
> Two looks — Paper (warm and editorial) and Noir (black and sharp) — and three voices, from gentle encouragement to no-excuses. Make it yours, then show up for yourself.

## Keywords (100 chars)
`habit,challenge,75 hard,accountability,goal,streak,tracker,daily,routine,discipline,fitness`

## App Privacy questionnaire (Data Collection)
Declare, all "Linked to you", none used for tracking, no third-party ads:
- **Contact Info → Name** (display name) and **Phone Number** (optional field at signup)
- **Health & Fitness** (weight entries, calorie/protein estimates — only if the user opts into body goals)
- **Photos or Videos** (proof photos)
- **User Content** (checklist content, chat messages with the setup guide)
- **Identifiers → User ID** (account id)
Collection purpose for all: **App Functionality**. Account deletion: in-app (avatar → Delete account).

## App Review notes (paste into the Notes field)
> You Mode is an accountability app where users build a custom daily challenge and prove daily items with photos, checkmarks, or built-in timers.
>
> DEMO ACCOUNT (pre-loaded, mid-challenge):
> username: applereview
> password: <REDACTED — this repo is public; use the real password shared privately when pasting into App Store Connect, whose Notes field is private>
>
> Suggested tour: the Today tab opens on a challenge already in progress, with some items done and some still open — tap "Journal" twice to log a twice-a-day item, tap "Meditate" to run the built-in timer (it completes the item by itself), and see weekly/monthly items in their own sections. Progress, History, and Goals tabs show the run so far. Tap the avatar (top right) for looks/voices, checklist editing, and in-app account deletion.
>
> Creating an account requires only a username and password (no email verification). The voice-to-challenge setup uses the microphone with permission; typing works identically without it.
>
> Health note: users may OPTIONALLY set weight/nutrition targets; the app applies conservative safety floors and refers users to professionals for anything outside safe ranges. No medical claims.

## Screenshots
NEEDED — the earlier set lived in a session scratchpad and is gone. Regenerate into
`docs/appstore-shots/` (durable, not a temp dir) so this can't evaporate again.
Capture from an **iPhone 16 Pro Max simulator** (1320×2868 is the required 6.9" size;
a smaller physical phone will not produce an accepted size). Order to upload:
1-today (ring + photo/check/counter/timer/weekly/monthly), 2-progress, 3-history, 4-goals, 5-make-it-yours.
The same set may be reused for the 6.5" slot.
Blocked on `xcode-select` pointing at Xcode — see Build & upload step 0.

## Demo account state (verified 2026-07-27)
`applereview` / "Jordan", challenge "Morning Momentum", solo, **day 14 of 90** (runs to
2026-10-11 so it cannot lapse mid-review, even across resubmissions). Days 1-13 complete
with a real proof image in storage; today deliberately left partial so the reviewer sees
both done and to-do items. Showcases every proof type: photo, check, 2×/day check, timer,
weekly, monthly. Password was rotated 2026-07-27 and shared with Kyle privately — paste
that value into the App Store Connect notes, not into this file.

## Build & upload (Kyle + Claude together, ~20 min)
0. **Point the command line at Xcode** (needs Kyle's password, one time — as of
   2026-07-27 this was still unset, which blocks every CLI/simulator build):
   `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`
   The Xcode GUI archives fine without this; simulator screenshots and headless builds do not.
1. `cd ios/App && open App.xcodeproj` — select the **App** target → Signing & Capabilities → check "Automatically manage signing" → Team: Kyle's Apple Developer team.
2. Bump Marketing Version to `1.0.0` if needed (General tab).
3. Menu: Product → Archive (destination "Any iOS Device"). When the Organizer opens: **Distribute App → App Store Connect → Upload** (defaults are fine).
4. In App Store Connect: the build appears under TestFlight in ~10 min. Answer the export-compliance question: **uses standard encryption (HTTPS) only → exempt**.
5. **TestFlight now:** add Miska/Mayssa/Dylen as internal testers — they get the real app today.
6. Attach the build to the 1.0 version, paste everything above, **Submit for Review**.

## Architecture note (for future us)
The wrapper loads https://youmode.app live (capacitor.config.json server.url), so web deploys reach App Store users instantly — app-store re-submissions are only needed for native changes (plugins, permissions, icons). The bundled-dist mode rendered a white screen (module scripts on the capacitor:// scheme); if we ever want offline-first, debug that with Safari Web Inspector against the sim.

## Known-honest risks
- **Guideline 4.2 (minimum functionality):** it's a web-backed app. Mitigations shipped: native haptics on day-complete and item logging, a daily 7pm local reminder notification, camera/mic/photo integration, App Store-quality UX. If Apple pushes back, we respond with the native roadmap (push notifications, widgets) rather than resubmitting blind.
- First submissions commonly bounce once. A rejection is a conversation, not a failure.
