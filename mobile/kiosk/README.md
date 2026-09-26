# VibeQueue device app (Flutter)

One Android APK for every VibeQueue product — **hotel / restaurant**, **school**
and **hospital**. The operator signs in with their normal VibeQueue account and
picks what the device should be; there is no pairing code and nothing to type
beyond the login. Design history and hardware notes:
[`docs/flutter-kiosk-plan.md`](../../docs/flutter-kiosk-plan.md) (§10–§11).

## Run

```bash
flutter pub get
# against a local `next dev` on the host (emulator sees it as 10.0.2.2):
flutter run
# against a deployed backend (this becomes the pre-filled server URL):
flutter run --dart-define=KIOSK_BASE_URL=https://<your-deployment>
flutter build apk --release --dart-define=KIOSK_BASE_URL=https://<your-deployment>
```

## How a device gets set up

1. **Sign in** — email + password. The account's tenant decides the product; there
   is no product picker. The server URL is pre-filled and tucked behind
   "Change server".
2. **Choose a service** — a card per thing this device can become, from the
   server's catalog (`lib/dal/app-services.ts`):
   - *Ticket kiosk* — guests take a number (hotel: type the bill number; school /
     hospital: pick a department or doctor). Prints a ticket.
   - *Announcement display* — waiting-area board that shows and speaks calls.
     "New announcement display" creates the TV screen on the spot.
   - *Staff screens* — hotel counters / kitchen display / delivery, school
     windows, hospital rooms, opened as full-screen web pages.
3. **Printer** (kiosks with none configured) and **admin PIN** (devices with none
   yet) — skipped when already set, so changing service later is one tap.

The device then locks to that service. A 5-second hold in the top-left corner
(or up-up-down-down-OK on a TV remote) + the PIN opens **Settings**, which has
*Change what this device shows* — the same picker, reusing the stored session.

A new hotel service needs **no APK release**: add an entry in
`lib/dal/app-services.ts`. The app renders any `web` entry as a page and skips a
`kind` it doesn't know.

## Layout

| Path | What |
| --- | --- |
| `lib/src/config/` | `DeviceConfig` (role, product, tokens, service, PIN, printer), `AuthSession` |
| `lib/src/api/` | `AppApi` (login / provision / create display / settings), per-product kiosk + display clients |
| `lib/src/models/` | Dart mirrors of the server DTOs — `app_service.dart`, `business/`, `hospital/`, school |
| `lib/src/state/` | riverpod providers per product (`providers`, `hospital_*`, `business_*`), auth |
| `lib/src/ui/setup/` | sign-in, service picker, wizard |
| `lib/src/ui/business/` | hotel ticket kiosk (keypad) and board |
| `lib/src/ui/hospital/`, `lib/src/ui/display/`, `kiosk_screen.dart` | hospital and school screens |
| `lib/src/ui/settings/` | Settings (device, printer, PIN, language, facility settings, change service) |
| `lib/src/printing/` | ESC/POS over network / USB / Bluetooth; ticket raster pipeline |
| `lib/src/announce/` | native text-to-speech announcers per product |

## Server routes this app uses

`/api/app/{login,refresh,provision,screens,settings}` (Bearer auth),
`/api/kiosk|hospital-kiosk|business-kiosk/[branchToken]/…` and
`/api/display|hospital-display|business-display/[screenToken]` (token in path).

## Tests

`flutter analyze && flutter test`. The layout tests sweep real panel sizes
(1366×768 terminal, 1024×600 and 800×480 budget panels, 1080p/4K TVs, phones) in
every locale — a screen that overflows or pushes a button off-screen fails there.

## Not done

Release signing (the release build is still signed with the debug key — make a
keystore before a client install); Device Owner / lock-task enrolment; a real
printer and tablet soak test; end-to-end sign-in against a live tenant.
