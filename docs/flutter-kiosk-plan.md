# Flutter Kiosk App — Build Plan

**Audience:** this doc is a handoff to a *different* Claude Code session that will build the app. Read it fully before writing any code. It assumes no prior context on this conversation — everything you need is either in this file or in the referenced repo paths.

**Repo:** `/home/akshay/Projects/queue-system` (Next.js + Supabase multi-tenant queue system; the school vertical is what this app targets). This plan lives at `docs/flutter-kiosk-plan.md` inside that repo.

---

## 0. What already exists — read before touching anything

There is a **working native Android kiosk wrapper already in production**, written 2 days before this plan, at `android-kiosk/` (a plain Kotlin/Gradle project, NOT Flutter — do not confuse it with what you're building). It's a WebView that loads the school kiosk web page and hands off `rawbt:` intents to the RawBT print app. Read these before starting, they encode real production decisions you must not silently drop:

- `android-kiosk/app/src/main/java/com/vibequeue/kiosk/MainActivity.kt` — kiosk-mode behavior worth preserving: fullscreen/hide system UI, ignore the back button, retry on page-load failure, **reclaim foreground after handing off to another app** (so the next visitor isn't stuck looking at the wrong app).
- `android-kiosk/app/src/main/java/com/vibequeue/kiosk/BootReceiver.kt` — auto-launches on device boot. Your Flutter app needs the equivalent (`RECEIVE_BOOT_COMPLETED` + a boot receiver, or a Flutter plugin that does this).
- `android-kiosk/app/src/main/AndroidManifest.xml` — `singleTask` launch mode, boot receiver, `<queries>` block for package visibility.
- `lib/school/printTicket.ts` — **this is the ground truth for how a ticket must look and why.** It deliberately rasterizes the ticket to a 1-bit bitmap rather than sending ESC/POS text commands, because: (a) tickets carry per-tenant logos, (b) the school product is bilingual EN/AR and Arabic text shaping breaks in ESC/POS text mode, (c) exact dot-width math matters (58mm roll, 384-dot/48mm-printable head at 8 dots/mm). **Your native printing must follow the same bitmap-rasterization strategy**, not ESC/POS text commands. Full math and reasoning is in that file's comments — read it, don't re-derive it.
- `lib/rawbtPrint.ts` / `lib/silentPrint.ts` — the web app's other print paths, for context only (not used by this app).
- `components/school/SchoolKiosk.tsx` — the current web kiosk UI (893 lines). This is the UX you're porting: service-selection grid, priority toggle, ticket confirmation, recent-tickets rail, bilingual copy (`COPY.en` / `COPY.ar` objects at the top of the file — copy them verbatim, don't re-translate), print-queue-doesn't-block-next-tap behavior.

This app **replaces `android-kiosk/`** for the kiosk device. Do not delete `android-kiosk/` — leave it as a fallback/reference until this app is verified on real hardware.

---

## 1. Scope — what to build and what NOT to build

Two very different pieces. Do not blur them.

### 1a. Kiosk app (the real work) — build this fully native
Runs on a tablet mounted in the lobby. Touch-only, unattended, always-on.
- Service-selection grid → issue token → **print ticket via a directly-connected thermal printer** (Bluetooth SPP or USB — no RawBT, no other app in the loop).
- Recent-tickets rail, reprint, cancel, move-to-another-department, priority toggle — same actions the web kiosk has today.
- Bilingual EN/AR with RTL layout support.
- Auto-launch on boot, kiosk/lock-task mode, auto-recover from a crashed WebView-equivalent (there is none — it's native — but auto-recover from a network drop / API error the same way `MainActivity.kt` retries on page-load failure).

### 1b. Customer-facing pages — WebView embeds, NOT native rebuilds
`join`, `track`, `display` stay dynamic — wrap the **existing** web routes in an in-app WebView screen rather than reimplementing them in Dart. This is explicitly the cheap path the product owner chose; do not "improve" it into a native rebuild without being asked.
- `/join/[branchId]` → `app/(public)/join/[branchId]/page.tsx`
- `/track/[queueId]` → `app/(public)/track/[queueId]/page.tsx`
- `/display/[token]` → `app/(public)/display/[token]/page.tsx`

Give the app a bottom nav or a simple menu to switch between "Kiosk" and these WebView screens if the build target needs both in one binary; more likely these ship as **separate app targets/flavors** (kiosk tablet vs. a generic branded app) — confirm with whoever hands you this before assuming one APK does both.

### 1c. Waiting-area display board audio — a WebView flag, not a rebuild

The school board at `/school/display/[screenToken]` (`app/(school)/school/(device)/display/[screenToken]/page.tsx` → `components/school/SchoolBoard.tsx`) produces sound in two ways:

1. **TTS token announcements** — `lib/school/announce.ts` (`SchoolAnnouncer`). It speaks via `window.AndroidTTS` when that JS interface exists, otherwise Web Speech + a WebAudio chime.
2. **Opt-in video-ad audio** (added alongside this doc) — the right-side ad rail (`components/school/SchoolAdRail.tsx`) shows one ad at a time and unmutes a video when its ad has `audio_enabled` set (managed at `/school/ads`).

**On a plain browser both are blocked** until a user gesture — a wall-mounted TV never gets one, which is the "audio doesn't play on the TV" bug. `SchoolBoard.tsx` renders a full-screen "Tap anywhere to enable sound" curtain as the fallback, but nobody is there to tap it.

**The fix is on the app side, and it's small.** Whatever screen hosts the display board must:

- Set the WebView to allow autoplay with sound — `mediaPlaybackRequiresUserGesture = false`. The existing `android-kiosk/app/src/main/java/com/vibequeue/kiosk/MainActivity.kt` already does exactly this (around line 82) for the kiosk page; do the equivalent for the display. For `flutter_inappwebview`: `InAppWebViewSettings(mediaPlaybackRequiresUserGesture: false)`. Do not start the WebView/app muted.
- Inject a JS interface named `AndroidTTS` with a `speak(String)` method (see `MainActivity.kt` line ~84 and its `TtsInterface`), OR accept that the board falls back to Web Speech + chime. `SchoolAnnouncer` auto-detects `window.AndroidTTS` and treats audio as ready when it's present, so injecting it also removes the tap curtain.
- The display is almost certainly its **own app target / route**, separate from the ticket kiosk screen (different device, different token — `screen_token` not `branch_token`). Don't try to force both into one screen.

No web code needs to change for this — `SchoolBoard.tsx` / `SchoolAnnouncer` / `SchoolAdRail` already handle the "audio is unlocked" and "AndroidTTS present" paths. This is purely a WebView-configuration task for the app that wraps the page.

### Explicitly out of scope
- Staff/counter console (`app/(counter)`-equivalent, `schoolCallNextAction` etc.) — stays web-only, staff use a browser.
- Admin/manager dashboard (`app/(school)/school/(manage)/*`) — stays web-only.
- Any rewrite of `join`/`track`/`display` as native Flutter widgets — not requested, don't do it.

---

## 2. Architecture

```
Flutter app (new, native)                Next.js app (this repo, extend it)
┌─────────────────────────┐              ┌──────────────────────────────────┐
│ Kiosk screens (Dart)     │  HTTPS/JSON  │ NEW: app/api/kiosk/[branchToken]/ │
│  - service grid          │─────────────▶│  wraps EXISTING server actions:   │
│  - ticket render+print   │              │  lib/actions/school-tokens.ts     │
│  - recent rail           │              │  lib/actions/school-read.ts       │
├─────────────────────────┤              │  lib/dal/school.ts                │
│ WebView screens          │  loads URLs  ├──────────────────────────────────┤
│  - join/track/display    │─────────────▶│ EXISTING web routes, unchanged    │
└─────────────────────────┘              └──────────────────────────────────┘
         │
         ▼
  Bluetooth/USB ESC/POS thermal printer (raster mode)
```

Nothing about the Supabase schema, RLS, or existing web app changes. You are additive: new API routes on the Next.js side, a new Flutter project. Do not touch `components/school/SchoolKiosk.tsx` or any existing web page.

---

## 3. Backend: new API routes (build these first, in this repo)

> **Status (2026-08-28): DONE.** All six routes exist under `app/api/kiosk/[branchToken]/`,
> plus shared HTTP-framing helpers in `lib/api/kiosk.ts`. They are thin wrappers over the
> existing actions/DAL exactly as specced below — `tsc --noEmit` and `eslint` are clean.
> Files:
> - `app/api/kiosk/[branchToken]/bootstrap/route.ts` → `getSchoolKioskPacket`
> - `app/api/kiosk/[branchToken]/feed/route.ts` → `fetchSchoolKioskFeedAction`
> - `app/api/kiosk/[branchToken]/tokens/route.ts` → `schoolIssueTokenAction`
> - `app/api/kiosk/[branchToken]/tokens/[id]/cancel/route.ts` → `schoolKioskCancelTokenAction`
> - `app/api/kiosk/[branchToken]/tokens/[id]/priority/route.ts` → `schoolKioskSetPriorityAction`
> - `app/api/kiosk/[branchToken]/tokens/[id]/move/route.ts` → `schoolKioskMoveTokenAction`
> - `app/api/kiosk/[branchToken]/tokens/[id]/waiting-ahead/route.ts` → `schoolKioskWaitingAheadAction`
>
> Status mapping (`errorStatus` in `lib/api/kiosk.ts`): unknown/disabled kiosk or a token id
> not addressable today → **404**; amending a token a counter already owns → **409**; other
> validation/business-rule rejections → **400**; success → **200**. Error body is always
> `{ error: string }` with the action's message verbatim. `/api/*` is already exempt from
> `proxy.ts` auth, so no session is needed. Smoke-tested on `next dev` with bogus tokens:
> 404 `{"error":"Kiosk is not registered"}` on all routes, 400 on missing body, 405 on
> `GET /tokens`. Still TODO: happy-path `curl` against a **real** branch token.

**Auth model — already solved, don't invent a new one.** The kiosk authenticates the same way the web kiosk page does: an opaque per-branch `branch_token` in the URL (see `supabase/schema.sql:104`, `lib/actions/school-tokens.ts` → `verifySchoolBranch`). The Flutter app stores this token in its device config (set once during kiosk setup, e.g. a hidden settings screen or QR-code provisioning) and sends it on every request. **Every route must re-verify the token server-side against the `branches` table exactly like the existing actions do** — never trust a client-supplied branch id.

Create `app/api/kiosk/` route handlers. These are **thin wrappers around existing, already-correct business logic** — do not reimplement queue logic, do not touch RPCs directly if an action already wraps them. Each route below names the exact existing function to call.

### `GET /api/kiosk/[branchToken]/bootstrap`
Wraps `getSchoolKioskPacket(branchToken)` (in `lib/dal/school.ts:123`). Returns everything the app needs to boot: branch name, department list, settings (school name EN/AR, logo URL, ticket footer EN/AR, `print_enabled`, `languages`), `silentPrint`/`printerName` (informational only — the app manages its own printer connection, doesn't need these, but return them anyway for parity).

### `GET /api/kiosk/[branchToken]/feed`
Wraps `fetchSchoolKioskFeedAction(branchToken)` (`lib/actions/school-read.ts:154`, itself wraps `getSchoolKioskFeed` in `lib/dal/school.ts:290`). Returns `{ status, serviceDate, recent: SchoolTokenDTO[], waitingByDepartment: Record<deptId, number>, waitingTotal, issuedToday }`. **Poll this every 6 seconds** — that's the interval the web kiosk uses (`FEED_POLL_MS = 6000` in `SchoolKiosk.tsx`), match it so behavior is identical.

### `POST /api/kiosk/[branchToken]/tokens`
Body: `{ departmentId: string, isPriority?: boolean }`. Wraps `schoolIssueTokenAction(branchToken, departmentId, isPriority)` (`lib/actions/school-tokens.ts:123`). Returns `{ token: SchoolTokenDTO, waitingAhead?: number } | { error: string }`. This is the RPC `claim_school_token` under the hood — don't call it directly, go through the action.

`waitingAhead` is how many visitors were still ahead of this token in its department the instant it was minted — the line the ticket prints ("3 people waiting before you"). It is deliberately not derived from the feed's `waitingByDepartment`: that is up to 6s stale and counts a whole department, not the people in front of one token. It is **optional**: absent means the count couldn't be read, and the ticket must then print without the line rather than with a number that isn't true.

### `POST /api/kiosk/[branchToken]/tokens/:id/cancel`
Wraps `schoolKioskCancelTokenAction`. Only valid for `waiting`/`held` tokens (server already enforces this — surface the error message as-is to the UI, don't re-derive the rule client-side).

### `POST /api/kiosk/[branchToken]/tokens/:id/priority`
Body: `{ isPriority: boolean }`. Wraps `schoolKioskSetPriorityAction`.

### `POST /api/kiosk/[branchToken]/tokens/:id/move`
Body: `{ departmentId: string }`. Wraps `schoolKioskMoveTokenAction`. Returns `waitingAhead` for the **target** department alongside the token.

### `GET /api/kiosk/[branchToken]/tokens/:id/waiting-ahead`
Wraps `schoolKioskWaitingAheadAction`. Returns `{ waitingAhead?: number }`. Read before a reprint from the recent rail: the queue moves while a ticket sits there, so the count on the original paper is stale. Best-effort on the client — a failed lookup prints the ticket without the line, it never blocks the reprint.

**Implementation notes for whoever builds this half:**
- Each existing action already does its own branch/token verification — the route handler's job is just: parse `branchToken` from the path, parse the body, call the action, serialize the result, set correct HTTP status (404 for "not-found" branch, 400 for validation errors, 200 otherwise). Don't add a second auth layer on top.
- Reuse the actions' TypeScript return types directly for the JSON shape — don't hand-write parallel interfaces that can drift.
- No new database access, no new RPCs. If a route needs data no existing action provides, that's a signal to add a thin new action next to the existing ones in `lib/actions/school-*.ts` (following their exact style — server-role client, branch-token verification, DTO mapping) rather than querying Supabase directly from the route handler.
- Rate limiting / abuse protection: out of scope for v1 (device is on a trusted LAN/token), but don't actively disable Next.js defaults.

---

## 4. Data models (Dart) — mirror these exactly

Source of truth: `lib/db/school-types.ts`. Field names below are the **camelCase DTO** shape (what the API returns), not the snake_case DB rows.

```dart
class SchoolTokenDTO {
  final String id, customerId, branchId, departmentId, serviceDate, tokenCode;
  final String? counterId, transferredFromDepartmentId;
  final int number, callCount, recallCount;
  final String status; // 'waiting'|'called'|'held'|'served'|'no-show'|'cancelled'
  final bool isPriority;
  final String source; // 'kiosk'|'staff'|'web'|'api'
  final String notes, joinedAt, createdAt;
  final String? calledAt, servedAt;
}

class SchoolDepartmentDTO {
  final String id, nameEn, nameAr, prefix, color, icon;
  final bool isPriority, isActive;
  final int displayOrder;
}

class SchoolSettingsDTO {
  final String schoolNameEn, schoolNameAr, logoUrl, ticketFooterEn, ticketFooterAr;
  final List<String> languages; // e.g. ['en','ar']
  final bool priorityEnabled, printEnabled;
  // kiosk_idle_seconds, announce_* fields exist on the settings row too —
  // include them if you build an idle/attract-screen or TTS announcements,
  // otherwise they're inert.
}

class SchoolKioskFeed {
  final String status; // 'ok'|'not-found'
  final String? serviceDate;
  final List<SchoolTokenDTO> recent;
  final Map<String, int> waitingByDepartment; // keyed by departmentId
  final int waitingTotal, issuedToday;
}
```

Check `lib/db/school-types.ts:182` (`SchoolTokenDTO`), `:257` (`SchoolKioskFeed`), and `lib/dal/school.ts:123` (`SchoolKioskPacket`, inline type — bootstrap response) for exact/current field lists before finalizing — this doc is a snapshot, the code is the source of truth if they've drifted.

---

## 5. Kiosk UI — port `SchoolKiosk.tsx`, don't redesign it

Read `components/school/SchoolKiosk.tsx` top to bottom before writing a single screen. Key behaviors to preserve, because they're deliberate fixes for real kiosk problems, not incidental:

- **The service grid never unmounts.** Issuing a token is a side effect shown in a side rail, not a page transition — because the next visitor can tap while the previous ticket is still printing. Model this as one persistent screen with a print queue, not a navigation stack.
- **Printing runs off a queue, and never blocks the next tap.** A `PrintJob` (token + department) is enqueued, printed asynchronously; the tap handler returns immediately.
- **Print failures never lose the ticket.** The token is already committed server-side (via the `POST /tokens` call) before printing starts — if the printer fails, the ticket number is still shown on screen and the visitor keeps it. Never make token issuance depend on print success.
- **Bilingual copy** — copy `COPY.en` / `COPY.ar` from the top of `SchoolKiosk.tsx` verbatim into your Dart localization, don't re-translate or paraphrase. Arabic requires RTL layout (`Directionality` widget / `TextDirection.rtl` in Flutter) — test both languages on real hardware, not just the emulator, since Arabic shaping bugs often only show up in real rendering.
- **Priority toggle** is a kiosk-side "arm the next ticket as priority" switch (`priorityArmed` state), not a per-tap parameter — check the component for exact interaction.
- **Recent-tickets rail**: last N tokens for the branch today (`RECENT_LIMIT = 30` in the web component), supports reprint/move/cancel per row.

---

## 6. Native printing — the highest-risk, highest-effort part

**Strategy: render-to-bitmap, same as the web app, not ESC/POS text mode.** This is not a style choice — it's required for the same three reasons `printTicket.ts` gives (per-tenant logo, Arabic shaping, exact dot math). Re-read `lib/school/printTicket.ts` before implementing; port its constants:

```
paperMm: 58        // roll width
printableMm: 48     // what the 384-dot head actually reaches
minHeightMm: 40      // floor, ticket is cut-to-length above that
rawbtDots: 384       // dots across — reuse as your raster width
tearFeedMm: 12        // blank feed after content so it clears the tear bar
                       // (drop to ~2 if the printer has an auto-cutter)
logoMaxMm: {width: 32, height: 14}
logoThreshold: 0.62   // luminance cutoff, dark below → black dot
```

Implementation shape:
1. Build the ticket as a Flutter widget (logo, school name EN/AR, token code big, department, footer text) sized to `printableMm` at whatever DPI maps 1:1 to the head's dots-per-mm (8 dots/mm here — same math as the web version's `dpmm` calc).
2. Capture it off-screen via `RepaintBoundary` → `toImage()` → raw pixels.
3. Convert to 1-bit monochrome using the same luminance-threshold approach as `prepareTicketLogo` in `printTicket.ts` (composite onto white first — don't let transparent PNG alpha read as black).
4. Encode as ESC/POS raster (`GS v 0` command) and send over the printer connection.
5. Send the trailing feed (`tearFeedMm`) as a paper-feed command, then (if the printer has one) a cut command — make the cut command a config flag per printer/branch, since not all hardware has an auto-cutter.

**Printer connectivity.** If the target is the **ZY307** (see §9 — the PDF at the repo root),
this is network-first: open a raw TCP socket to the printer's IP on **port 9100** and write the
ESC/POS byte stream directly (`dart:io` `Socket` — no package needed), or USB via `usb_serial`.
No Bluetooth. The `esc_pos_utils` package (or `esc_pos_utils_plus`) is still useful for building
the `GS v 0` raster + `GS V` cut bytes; check pub.dev freshness. Needs, regardless of transport:
- Printer address/selection UI, persisted per-device (`KioskConfig` already does shared-prefs persistence) so it survives restarts. For network: the printer's static IP; for USB: the device id.
- Reconnect-on-demand — a kiosk left on for days will have the socket drop / printer sleep; detect and reconnect transparently on the next job, don't require a human.
- Paper-out / offline error surfaced on screen (there's nobody at an unattended kiosk to see a silent failure otherwise — the visitor needs to know their number even if it didn't print, mirroring the web app's `printFailed` copy: *"The printer is unavailable. Please note your number."* — already wired to `lastPrintResultProvider` → the red banner in `kiosk_screen.dart`). The ZY307 has real paper-out / cover-open sensors; read status back over the same socket (`DLE EOT n`).
- **Confirm the model on site before finalising the raster width** (576 vs 512 vs 384 — depends on which paper-width separator is fitted) and the exact cut command the firmware honours.

---

## 7. Kiosk-mode device behavior (Android)

Port these from `android-kiosk/` (see §0), Flutter-native equivalents:
- Fullscreen, hide system bars — `SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky)`.
- Disable back button — intercept via `PopScope`/`WillPopScope`.
- Auto-launch on boot — Android boot receiver (native platform channel or a plugin like `android_alarm_manager_plus`/manual manifest edit in `android/app/src/main/`).
- Consider Android's built-in **Lock Task Mode / kiosk mode** (`startLockTask()`) if the device is dedicated hardware — stronger than just hiding system UI, prevents the visitor from ever leaving the app via recents/home.
- Retry-on-error: if `bootstrap`/`feed` calls fail (network drop), show a retry state and keep polling — don't crash to a blank screen, matching `MainActivity.kt`'s reload-on-error behavior.

---

## 8. Suggested build order

1. ~~**Backend routes** (§3)~~ — **DONE 2026-08-28**, see the status box in §3. Still `curl`-test against a real branch token on a running dev server before writing any Dart.
2. ~~**Flutter project scaffold**~~ — **DONE 2026-08-28**, at `mobile/kiosk/` (project name `school_kiosk`, org `com.vibequeue`, Android-only). Deps: `dio`, `flutter_riverpod` (v3), `shared_preferences`. `flutter analyze` and `flutter test` clean.
3. **Bootstrap + feed screens with mock/no printing** — **WORKING END-TO-END 2026-08-29** against the live deployment + a real branch token on real hardware (RK3566 / Android 11 / 1366×768 landscape kiosk tablet). Config + models (`lib/src/models/`), `KioskApi` Dio client for all six routes (`lib/src/api/`), riverpod providers incl. 6s feed poll + non-blocking `PrintQueue` (`lib/src/state/providers.dart`), staff setup screen, and the parent-facing kiosk screen. **UI/UX redesigned 2026-08-29** for the landscape kiosk: `lib/src/ui/theme.dart` (flat palette, no blur — weak GPU), top bar with logo + `EN | العربية` toggle, big service cards with lucide→Material icon map (`lib/src/ui/dept_icon.dart`) + live queue pills, full-screen token confirmation overlay (`confirmation_overlay.dart`), priority toggle banner, cleaner recent rail. Orientation locked landscape in `main.dart`. **Fully responsive** to arbitrary screen sizes: `kioskScaleForSize`/`kioskTextScaleForSize` in `theme.dart` derive one proportional factor from `min(w/1366, h/768)`; the `app.dart` MediaQuery override feeds it into `TextScaler.linear` (still ignoring the OS font-size setting), and the header, grid row-height clamps, rail width and confirmation overlay all scale off it. Guarded by `test/layout_smoke_test.dart` (71 cases, 640×360 → 2560×1440, both langs). **Not yet done:** the rail's per-row reprint/move/cancel/priority actions (API methods exist, UI is read-only); attract/idle screen. Verbatim `COPY.en`/`COPY.ar` are in `lib/src/i18n/copy.dart` (plus two app-only strings: `doneLabel`, `tapAnywhere`).

   Web side: `components/school/SchoolScreensManager.tsx` (`/school/screens`) now shows the raw **kiosk app token** with a copy button, for provisioning the Android app.
4. **Ticket rendering to bitmap** — build the widget-to-raster pipeline (§6 steps 1–3), verify visually (save the bitmap to a file and eyeball it) before wiring up a physical printer. `Printer` interface + `PrintQueue` already in `lib/src/printing/`; swap `DebugPrinter` for the real impl.
5. **Printer connectivity** — once physical hardware is available. This is where the real time risk lives; budget slack here.
6. **Kiosk-mode device behavior** (§7).
7. **WebView screens for join/track/display** (§1b) — cheap, do last, doesn't block the core kiosk flow.
8. **Soak test on the actual tablet/printer for at least a full day** before calling it done — unattended-hardware bugs (sleep, reconnect, memory growth from a long-lived polling loop) don't show up in a 10-minute dev session.

---

## 9. Open questions to resolve with the product owner before/while building

- ~~Exact printer make/model and connection type~~ — **likely answered.** `ZY307 usb lan, wifi.pdf`
  at the repo root is almost certainly the target printer: **80 mm roll** (72 mm / 576–572
  dots printable — NOT the 58 mm / 384 the plan and `printTicket.ts` assume), ESC/POS
  emulation, interfaces **USB + serial + LAN + WiFi (no Bluetooth)**, **built-in auto-cutter**
  (full or partial cut), paper-out / cover-open / cutter-jam sensors, Android+iOS SDK.
  Implications if confirmed: (a) §6's raster width becomes **576** (or 512 for a 64 mm
  separator — the printer ships with selectable paper-width separators), rework the dot math
  in `printTicket.ts`'s constants for the app; (b) connectivity is **raw TCP to port 9100**
  (network) or USB — much simpler and more reliable than Bluetooth SPP, drop the
  `esc_pos_bluetooth` candidate; (c) `tearFeedMm` drops to ~2 and a **cut command** (`GS V`)
  is always sent. **Still confirm with the product owner** that this PDF is the kiosk printer
  and not leftover from something else, and get the exact model of what's physically on site.
- ~~Does one APK need both the kiosk UI and the join/track/display WebView screens, or are these separate app targets?~~ — **answered 2026-08-30: one APK, multi-role.** See §10.
- ~~Kiosk device provisioning: how does a new tablet get its `branch_token` on first boot~~ — **answered 2026-08-30.** Manual entry or QR scan, both in the setup wizard's Pair step. See §10.
- ~~Auto-cutter present~~ — yes, if the ZY307 is the target (see above).

---

## 10. Multi-role rebuild (2026-08-30)

The product owner asked for one APK covering three fixed-purpose screens, each configured
once at install time and then locked: **kiosk** (this doc, above), **announcement display**
(native, not a WebView — supersedes §1c's WebView-flag plan), and **web screen** (thin
WebView wrapper, what §1b called the join/track case). Full plan:
`/home/akshay/.claude/plans/okay-we-need-the-linked-music.md`.

**Status: built and compiling end-to-end 2026-08-30** — `flutter analyze` clean (one style
info), `flutter test` green (101 cases across `test/*.dart`), `flutter build apk --debug`
succeeds including the new native Kotlin plugin. Not yet run on physical hardware.

- **Device roles** (`lib/src/config/device_role.dart`, `device_config.dart`) — `DeviceConfig`
  replaces the old two-field `KioskConfig`, adding `role`, `screenToken`, `webUrl`, an admin
  PIN (hash+salt+length), and a `PrinterSettings` JSON blob, while keeping every
  shared_preferences key the old config wrote. **Migration:** a tablet already in the field
  with `kiosk.branchToken` set but no `device.role` key loads as an already-complete kiosk —
  verified in `test/device_config_test.dart`. `app.dart`'s `_Root` now switches on `cfg.role`
  instead of the old boolean branch.
- **Setup wizard** (`lib/src/ui/setup/setup_wizard.dart` + `printer_setup_step.dart`,
  `pin_step.dart`, `qr_scan_screen.dart`) — 6 steps: Server → Role → Pair (manual token or QR
  scan, validated live against `bootstrap`/`display` before letting the installer continue) →
  Printer (kiosk only) → PIN → Review & lock.
- **Admin gate** (`lib/src/ui/admin/admin_gate.dart`, `pin_pad.dart`) — 5-second hold in the
  top-left 64×64 corner, then a PIN (4–6 digits, salted SHA-256, `lib/src/config/admin_pin.dart`),
  3-strikes/30s lockout, reopens the wizard pre-filled for changes.
- **Printing, finished end-to-end** (`lib/src/printing/`): hand-rolled ESC/POS byte builder
  (`escpos.dart` — no `esc_pos_utils` dependency); three transports behind one interface
  (`transport/` — `NetworkPrinterTransport` is pure `dart:io`, USB and Bluetooth go through a
  new native Android plugin, `PrinterPlugin.kt`, since ESC/POS printers enumerate as USB
  *printer class* 0x07, which a generic USB-serial package cannot see); concurrent
  auto-discovery across all three (`discovery.dart` — USB/BT enumerate instantly, network
  sweeps the tablet's own `/24` on port 9100 in ~3–4s, no `network_info_plus` needed); the
  ticket render-to-raster pipeline (`ticket_widget.dart`, `ticket_capture_host.dart`,
  `ticket_raster.dart` — renders a real Flutter widget off-screen, thresholds it to 1bpp,
  packs `GS v 0`); `EscPosPrinter` wired into the existing `Printer`/`PrintQueue` interface
  with reconnect-on-demand and `DLE EOT` paper/cover status surfaced as distinct banner text
  (`copy.printOutOfPaper` / `printCoverOpen`, EN+AR). **Paper width is not auto-detected** —
  clone printers answer `GS I` unreliably — so the wizard prints a calibration ruler ticket
  instead and the installer confirms 58/80mm by eye; this is the one place discovery falls
  back to a human rather than a query.
- **Announcement display, native** (`lib/src/announce/announcer.dart`,
  `lib/src/ui/display/`, `lib/src/state/board_providers.dart`) — new backend route
  `GET /api/display/[screenToken]` (thin wrapper over the existing `getSchoolBoard` RPC,
  mirrors the kiosk routes' framing); `flutter_tts` with `spellToken`/`ARABIC_LETTER_NAMES`/
  template-fill ported verbatim from `lib/school/announce.ts`; 3s poll (faster than the web
  board's 8s); one row per **open** counter, not "last N called"; ad rail with per-ad
  audio-enable and ducking while an announcement is speaking; bottom ticker. No autoplay/tap-
  to-enable-sound problem exists here at all — native TTS needs no user gesture, so §1c's
  WebView-flag plan is superseded for this role (still correct advice if a WebView board is
  ever needed elsewhere).
- **Web screen role** (`lib/src/ui/web/web_screen.dart`) — uses `webview_flutter`, not
  `flutter_inappwebview` as originally drafted: `flutter_inappwebview_android` 1.1.3's own
  `build.gradle` calls a Gradle API this project's AGP 9.0.1 removed outright, and no
  non-beta fix was published yet. `webview_flutter` sets the same
  `mediaPlaybackRequiresUserGesture(false)` via `AndroidWebViewController` and built cleanly.
- **Provisioning QR** — `components/school/ProvisioningQrDialog.tsx`, wired into both the
  kiosk-token panel and each display row in `SchoolScreensManager.tsx`. Encodes
  `{v:1, baseUrl, role, token}`; parsed by `lib/src/config/provisioning_qr.dart` and scanned
  via `mobile_scanner` in the wizard's Pair step.
- **Kiosk hardening, partial**: `PopScope(canPop: false)` wraps every role screen;
  `WakelockPlus` enabled on kiosk and display; `BootReceiver.kt` added and wired into the
  manifest (was declared but missing since the original scaffold). **Still open:**
  `startLockTask()` / Device Owner enrollment (needs real MDM provisioning to test, can't be
  meaningfully finished from a dev machine), and the release build is **still signed with the
  debug key** (`android/app/build.gradle.kts`) — generate a real keystore before any client
  install.
- **New tests**: `test/device_config_test.dart` (migration + round-trip),
  `test/announcer_test.dart` (`spellToken` against `announce.ts`'s exact cases +
  `AnnouncementDedupe`'s recall-reannounces behaviour), `test/escpos_test.dart` (raster byte
  packing), `test/admin_pin_test.dart` (hash round-trip + salt uniqueness),
  `test/board_layout_smoke_test.dart` (bilingual EN/AR board rows across TV sizes up to 4K).

**Not done / needs real hardware:** anything in step 5 of §8 that only a physical printer can
confirm (actual ZY307 raster output, real USB/Bluetooth device pairing, paper-out sensor
behaviour); the day-long soak test; Device Owner / Lock Task enrollment; release signing.

## 11. Standalone app: sign-in + service picker, and the hotel vertical (2026-09-24)

The product owner asked for the APK to cover the hotel / business product and hospital as
well as school, to work **standalone** (no pairing codes), to log in, and to let the client
simply choose what a device shows — mostly a ticket kiosk or an announcement display, with
more hotel services to be added over time.

**Supersedes §10's Pair step, provisioning QR and 6-step wizard.** Sign-in and provisioning
already existed for school + hospital on the `queue-system-india` line; this work built the
missing hotel side and replaced the wizard with a two-decision flow. Built on branch
`app-standalone` (= `queue-system-india` + `main` merged).

- **Flow** — sign in → *choose a service* → (printer, only for a kiosk with none) → (PIN,
  only if none) → running. `lib/src/ui/setup/{login_step,service_step,setup_wizard}.dart`.
  Settings → *Change what this device shows* re-opens the picker with the stored session
  (`SetupWizard(changeMode: true)`); closing it leaves the running device untouched.
- **Server-driven service catalog** — `lib/dal/app-services.ts` builds `AppService[]` per
  account and `/api/app/login` + `/api/app/provision` return it as `services`. Kinds: `kiosk`
  (branch token), `display` (screen token), `web` (a server path, opened full-screen).
  Hotel counters (`/counter/<token>`: order, billing, kitchen, delivery, call), school windows
  and hospital rooms are `web` services — so new hotel screens ship server-side with no APK
  release. An unknown `kind` is dropped client-side; a server that predates the field gets
  kiosk + display synthesised from branches/screens (`AppService.synthesize`).
- **Create a display from the app** — `POST /api/app/screens` (`lib/dal/app-screens.ts`) makes
  the TV screen with the same plan quota (`max_screens_per_branch`) the three web
  create-screen actions enforce, so a fresh account needs no dashboard visit.
- **Hotel kiosk** — bill-number keypad (hardware keyboard / wedge scanner also works; Enter
  submits) → `POST /api/business-kiosk/[branchToken]/tickets` → `kioskAddEntryAction`, now
  honouring `allow_self_join` and `max_capacity` like the public join page. Ticket prints via
  the existing pipeline (business name, queue number, "Bill N"); **no QR** — the business
  product has no public tracking page (`/track/[id]` redirects to `/display`).
- **Hotel board** — `GET /api/business-display/[screenToken]` (wraps `get_screen_data`): now
  serving + next up + ad rail + ticker + spoken calls. Announces `Token number N` from
  `callCount` changes; it does **not** replicate the web board's "announce the bill number for
  a *call*-type counter" (the packet doesn't say which counter type called).
- **Egress** — both hotel device reads go through the version-gated cache
  (`lib/cache/businessCache.ts`, same store as school). Every business queue mutation
  (`lib/actions/queue.ts` via `logActivity`, and all nine inserts in `lib/actions/counters.ts`)
  calls `publishBusinessChange(branchId)`. **A new business mutation that skips this leaves
  the board stale for up to 30s.** Single-replica only, like the school cache.
- **Not changed**: `/api/pair`, `device-pairing.ts` and the web pairing dialogs are left for
  already-installed older APKs. Delete them once those are retired.

**Verified**: `flutter analyze` clean, `flutter test` green (489), release APK builds,
`next build --webpack` compiles every route, and bogus-token / no-auth curls return the
intended 404/400/401. **Not verified**: a real sign-in and ticket issue against a hotel tenant
(the Spice Garden demo lives on the India DB, whose credentials weren't available), and
anything on physical hardware.

