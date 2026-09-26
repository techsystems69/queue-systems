import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../config/device_role.dart';
import '../config/device_vertical.dart';
import '../printing/ticket_capture_host.dart';
import '../state/providers.dart';
import 'admin/admin_gate.dart';
import 'business/business_board_screen.dart';
import 'business/business_kiosk_screen.dart';
import 'display/board_screen.dart';
import 'hospital/hospital_board_screen.dart';
import 'hospital/hospital_kiosk_screen.dart';
import 'kiosk_screen.dart';
import 'settings/settings_screen.dart';
import 'setup/setup_wizard.dart';
import 'theme.dart';
import 'web/web_screen.dart';

class KioskApp extends StatelessWidget {
  const KioskApp({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = buildKioskTheme();

    return MaterialApp(
      title: 'VibeQueue',
      debugShowCheckedModeBanner: false,
      // Light only, unconditionally. Every slot gets the same light theme so a
      // device switched to dark mode (or high contrast) at dusk cannot repaint
      // a lobby terminal that is read across a bright room.
      theme: theme,
      darkTheme: theme,
      highContrastTheme: theme,
      highContrastDarkTheme: theme,
      themeMode: ThemeMode.light,
      builder: (context, child) {
        final media = MediaQuery.of(context);
        return MediaQuery(
          // Pin the OS knobs a kiosk must not honour: the device font-size and
          // bold-text settings would overflow the fixed grid, and
          // platformBrightness stays light so no descendant can branch on it.
          //
          // Text still scales — but to the *screen size*, not the OS setting:
          // a 1024×600 panel and a 2560×1440 one both need to read correctly,
          // so we substitute a proportional factor derived from the viewport.
          data: media.copyWith(
            platformBrightness: Brightness.light,
            textScaler:
                TextScaler.linear(kioskTextScaleForSize(media.size)),
            boldText: false,
            invertColors: false,
          ),
          child: AnnotatedRegion<SystemUiOverlayStyle>(
            value: KioskPalette.systemOverlay,
            // Mounted once, near the root, for every role: the print pipeline
            // (ticket_capture_host.dart) needs somewhere in the live widget
            // tree to render a ticket off-screen before rasterizing it. Only
            // the kiosk role ever actually calls it, but it's harmless — and
            // much simpler — to have it always present than to thread it
            // through per-role.
            child: TicketCaptureHost(
              child: child ?? const SizedBox.shrink(),
            ),
          ),
        );
      },
      home: const _Root(),
    );
  }
}

/// Routes to the setup wizard until the device is provisioned, then to the
/// screen for its locked-in role. Every role screen is wrapped in
/// [AdminGate], which is what makes settings reachable again later.
class _Root extends ConsumerWidget {
  const _Root();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final config = ref.watch(deviceConfigProvider);

    return config.when(
      loading: () => const _Splash(),
      error: (e, _) => _Splash(message: '$e'),
      data: (cfg) {
        // Temporary diagnostic: a wrong-screen-after-setup report is
        // otherwise impossible to debug without the device in hand — this
        // makes the actually-persisted role/tokens visible in `flutter run`'s
        // console the moment `_Root` decides what to show. Cheap to leave in;
        // strip once the report above is resolved.
        debugPrint(
          '[VibeQueue] _Root routing: role=${cfg.role} vertical=${cfg.vertical} '
          'setupComplete=${cfg.setupComplete} isComplete=${cfg.isComplete} '
          'branchToken=${cfg.branchToken.isEmpty ? "(empty)" : "(set)"} '
          'screenToken=${cfg.screenToken.isEmpty ? "(empty)" : "(set)"} webUrl=${cfg.webUrl}',
        );
        if (!cfg.setupComplete || !cfg.isComplete || cfg.role == null) {
          return const SetupWizard();
        }
        // (role, product) → screen. The role says what the device is (kiosk /
        // board / web page); the product — the tenant's, set at sign-in — says
        // which flavour of it. The web role is product-neutral: it just opens
        // the URL the chosen service resolved to.
        final roleScreen = switch (cfg.role!) {
          DeviceRole.kiosk => switch (cfg.vertical) {
              DeviceVertical.hospital => const HospitalKioskScreen(),
              DeviceVertical.business => const BusinessKioskScreen(),
              DeviceVertical.school => const KioskScreen(),
            },
          DeviceRole.display => switch (cfg.vertical) {
              DeviceVertical.hospital => const HospitalBoardScreen(),
              DeviceVertical.business => const BusinessBoardScreen(),
              DeviceVertical.school => const BoardScreen(),
            },
          DeviceRole.web => WebScreen(url: cfg.webUrl),
        };
        return PopScope(
          // Kiosk-mode hardening: the back button must never leave whatever
          // role screen the device is locked into.
          canPop: false,
          child: AdminGate(
            settingsBuilder: (_) => const SettingsScreen(),
            child: roleScreen,
          ),
        );
      },
    );
  }
}

class _Splash extends StatelessWidget {
  const _Splash({this.message});
  final String? message;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: message == null
            ? const CircularProgressIndicator()
            : Padding(
                padding: const EdgeInsets.all(32),
                child: Text(
                  message!,
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: KioskPalette.inkSoft),
                ),
              ),
      ),
    );
  }
}
