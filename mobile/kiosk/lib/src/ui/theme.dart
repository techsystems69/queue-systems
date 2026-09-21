import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Visual language for the parent-facing kiosk. Tuned for a fixed 1366×768
/// landscape terminal on a low-power RK3566 chip: flat surfaces, hairline
/// borders, one soft shadow, no blur — heavy compositing drops frames on this
/// GPU.
///
/// The kiosk is **light-mode only**. There is no dark palette anywhere in the
/// app: a lobby terminal is bright-room hardware, and a system dark mode
/// flipping the screen at dusk would leave a half-inverted, unreadable UI.
/// `buildKioskTheme()` is wired into every ThemeData slot in app.dart.
class KioskPalette {
  KioskPalette._();

  static const bg = Color(0xFFF7F8FC);
  static const surface = Color(0xFFFFFFFF);
  static const surfaceMuted = Color(0xFFF1F3F9);
  static const border = Color(0xFFE7EBF2);
  static const borderStrong = Color(0xFFD6DCE7);

  static const ink = Color(0xFF101828);
  static const inkSoft = Color(0xFF5B6577);
  static const inkFaint = Color(0xFF98A1B0);

  /// The announcement board's "called" colour — emerald-600, the web board's
  /// `accent-600` (app/globals.css). Fixed rather than per-department so the
  /// two boards read as the same product.
  static const accent = Color(0xFF059669);

  static const primary = Color(0xFF2F5BEA);
  static const primaryInk = Color(0xFFFFFFFF);
  static const primarySoft = Color(0xFFE9EEFE);

  static const priority = Color(0xFFB4530A);
  static const prioritySoft = Color(0xFFFDF0E3);

  static const success = Color(0xFF15803D);
  static const successSoft = Color(0xFFE6F5EC);
  static const danger = Color(0xFFB91C1C);
  static const dangerSoft = Color(0xFFFCE8E8);

  /// One reusable shadow. Cheap: single layer, low blur.
  static const cardShadow = [
    BoxShadow(color: Color(0x0F1E293B), blurRadius: 14, offset: Offset(0, 6)),
  ];

  /// Barely-there lift for the header and floating pills.
  static const hairShadow = [
    BoxShadow(color: Color(0x08101828), blurRadius: 6, offset: Offset(0, 2)),
  ];

  static const radius = 22.0;
  static const radiusSm = 14.0;
  static const radiusPill = 999.0;

  /// Header bar height. Fixed so the service area below it is predictable.
  /// A wayfinding rail, not a title bar — the service blocks below are what
  /// the visitor came for, so the chrome gives them the height back.
  static const headerHeight = 64.0;

  /// The ground the service blocks sit on. A touch deeper than [bg] so a wall
  /// of saturated colour has something to sit *on* rather than float over —
  /// the kiosk screen only; the board and the setup flow keep [bg].
  static const bgDeep = Color(0xFFEDF0F6);

  /// Status/nav bar styling for the rare moment the system bars are swiped in
  /// over the immersive kiosk — dark glyphs on our light chrome.
  static const systemOverlay = SystemUiOverlayStyle(
    statusBarColor: Color(0x00000000),
    statusBarBrightness: Brightness.light,
    statusBarIconBrightness: Brightness.dark,
    systemNavigationBarColor: surface,
    systemNavigationBarIconBrightness: Brightness.dark,
    systemNavigationBarDividerColor: border,
  );
}

/// One number that expresses "how much bigger/smaller is this screen than the
/// 1366×768 reference". Everything that must scale with the device — text (via
/// the MediaQuery override in app.dart) and the few genuinely fixed boxes (the
/// header bar, the grid's row-height clamps) — multiplies by this.
///
/// It's the *smaller* of the width and height ratios, so scaling up never
/// pushes content off the short axis, and it's clamped hard so a phone or an
/// oversized panel still lands in a sane range. Deliberately independent of the
/// OS font-size setting — that stays pinned off (see app.dart).
double kioskScale(BuildContext context) =>
    kioskScaleForSize(MediaQuery.sizeOf(context));

double kioskScaleForSize(Size size) {
  if (size.isEmpty) return 1;
  final r = math.min(size.width / 1366.0, size.height / 768.0);
  if (!r.isFinite || r <= 0) return 1;
  return r.clamp(0.82, 1.7);
}

/// Tighter band for text: the layout tolerates boxes growing 70%, but letting
/// every string grow that much turns a calm screen shouty and risks a label
/// outrunning a box that isn't itself scaled.
double kioskTextScaleForSize(Size size) =>
    kioskScaleForSize(size).clamp(0.9, 1.28);

/// Same idea as [kioskScaleForSize] but for the announcement board: a TV is
/// read from across a room rather than touched from arm's length, so it's
/// scaled off a 1920×1080 baseline instead of the kiosk's 1366×768.
///
/// This is the board's **only** size multiplier — board_screen.dart wraps
/// itself in `MediaQuery.withNoTextScaling`, deliberately opting out of the
/// app-wide [kioskTextScaleForSize] in app.dart. Two multipliers stacked on
/// one screen made every number the product of a visible `n * scale` and an
/// invisible ×1.28, which is how the board ended up rendering at reading
/// distance on a wall-mounted panel.
///
/// The clamp floor is deliberately low. Every size on the board is a fraction
/// of the viewport, so a set-top box negotiating 1280×720 (or handing Flutter
/// a small logical size after devicePixelRatio) still lands the same *physical*
/// proportion of the same TV — clamping the ratio up would blow the layout out
/// of a small viewport instead of protecting it.
double boardScaleForSize(Size size) {
  if (size.isEmpty) return 1;
  final r = math.min(size.width / 1920.0, size.height / 1080.0);
  if (!r.isFinite || r <= 0) return 1;
  return r.clamp(0.35, 2.2);
}

ThemeData buildKioskTheme() {
  const scheme = ColorScheme.light(
    primary: KioskPalette.primary,
    onPrimary: KioskPalette.primaryInk,
    primaryContainer: KioskPalette.primarySoft,
    onPrimaryContainer: KioskPalette.primary,
    surface: KioskPalette.surface,
    onSurface: KioskPalette.ink,
    surfaceContainerHighest: KioskPalette.surfaceMuted,
    error: KioskPalette.danger,
    errorContainer: KioskPalette.dangerSoft,
    onErrorContainer: KioskPalette.danger,
    outline: KioskPalette.border,
    outlineVariant: KioskPalette.border,
  );

  final base = ThemeData(
    useMaterial3: true,
    brightness: Brightness.light,
    colorScheme: scheme,
    scaffoldBackgroundColor: KioskPalette.bg,
    canvasColor: KioskPalette.bg,
    fontFamilyFallback: const [
      'Noto Sans Arabic',
      'Noto Naskh Arabic',
      'Geeza Pro',
      'Arial',
    ],
    splashFactory: InkSparkle.splashFactory,
  );

  return base.copyWith(
    textTheme: base.textTheme.apply(
      bodyColor: KioskPalette.ink,
      displayColor: KioskPalette.ink,
    ).copyWith(
      // Every style below states its own colour. `apply()` above sets one on
      // the styles it inherits, but a `copyWith` entry *replaces* the style
      // wholesale — a colourless heading then falls back to whatever
      // DefaultTextStyle happens to be in scope (inside a Scaffold that is
      // bodyMedium, the muted body colour), which is how "Please select a
      // service" ended up paler than the hint underneath it.
      displayLarge: const TextStyle(
        fontSize: 132,
        height: 1.0,
        fontWeight: FontWeight.w800,
        letterSpacing: -2,
        color: KioskPalette.ink,
      ),
      headlineMedium: const TextStyle(
        fontSize: 32,
        fontWeight: FontWeight.w700,
        color: KioskPalette.ink,
      ),
      headlineSmall: const TextStyle(
        fontSize: 26,
        fontWeight: FontWeight.w700,
        color: KioskPalette.ink,
      ),
      titleLarge: const TextStyle(
        fontSize: 22,
        fontWeight: FontWeight.w700,
        color: KioskPalette.ink,
      ),
      titleMedium: const TextStyle(
        fontSize: 17,
        fontWeight: FontWeight.w600,
        color: KioskPalette.ink,
      ),
      bodyLarge: const TextStyle(fontSize: 17, color: KioskPalette.inkSoft),
      bodyMedium: const TextStyle(fontSize: 15, color: KioskPalette.inkSoft),
      labelLarge: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
    ),
    dividerTheme: const DividerThemeData(
      color: KioskPalette.border,
      thickness: 1,
      space: 1,
    ),
    // Every tap target on a kiosk is finger-sized; the Material defaults are
    // mouse-sized.
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(0, 56),
        padding: const EdgeInsets.symmetric(horizontal: 28),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(KioskPalette.radiusSm),
        ),
        textStyle: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(0, 56),
        padding: const EdgeInsets.symmetric(horizontal: 28),
        side: const BorderSide(color: KioskPalette.borderStrong),
        foregroundColor: KioskPalette.ink,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(KioskPalette.radiusSm),
        ),
        textStyle: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: KioskPalette.surfaceMuted,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(KioskPalette.radiusSm),
        borderSide: const BorderSide(color: KioskPalette.border),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(KioskPalette.radiusSm),
        borderSide: const BorderSide(color: KioskPalette.border),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(KioskPalette.radiusSm),
        borderSide: const BorderSide(color: KioskPalette.primary, width: 1.6),
      ),
    ),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: KioskPalette.ink,
      contentTextStyle: const TextStyle(
        color: Colors.white,
        fontSize: 16,
        fontWeight: FontWeight.w600,
      ),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(KioskPalette.radiusSm),
      ),
      behavior: SnackBarBehavior.floating,
    ),
    progressIndicatorTheme: const ProgressIndicatorThemeData(
      color: KioskPalette.primary,
    ),
  );
}
