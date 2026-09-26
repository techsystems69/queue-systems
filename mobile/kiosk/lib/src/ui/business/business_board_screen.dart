import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:wakelock_plus/wakelock_plus.dart';

import '../../announce/business_announcer.dart';
import '../../i18n/business_copy.dart';
import '../../models/board_packet.dart' show BoardAd;
import '../../models/business/business_board_packet.dart';
import '../../state/app_auth_providers.dart';
import '../../state/business_providers.dart';
import '../display/widgets/board_ad_rail.dart';
import '../display/widgets/board_clock.dart';
import '../display/widgets/board_ticker.dart';
import '../theme.dart';
import 'business_boot_error.dart';

/// How long a fresh call takes over the whole screen.
const _flashDuration = Duration(seconds: 8);

/// The hotel / restaurant waiting-area board. The same three jobs as the web
/// board (components/display/TVDisplay.tsx) — show what's being served, show
/// who is next, announce each call out loud — native, so there is no "tap to
/// enable audio" curtain: the OS speech engine needs no user gesture.
///
/// Sized like every board: off a 1920×1080 baseline and read from across a room,
/// so it opts out of the app-wide text scaler and carries its own multiplier.
class BusinessBoardScreen extends ConsumerStatefulWidget {
  const BusinessBoardScreen({super.key});

  @override
  ConsumerState<BusinessBoardScreen> createState() =>
      _BusinessBoardScreenState();
}

class _BusinessBoardScreenState extends ConsumerState<BusinessBoardScreen> {
  final _dedupe = BusinessAnnouncementDedupe();
  BusinessServing? _flash;
  Timer? _flashTimer;

  @override
  void initState() {
    super.initState();
    WakelockPlus.enable();
  }

  @override
  void dispose() {
    WakelockPlus.disable();
    _flashTimer?.cancel();
    super.dispose();
  }

  void _handlePacket(BusinessBoardPacket packet) {
    if (!packet.isOk) return;
    final fresh = _dedupe.newCall(packet.serving);
    if (fresh == null) return;

    ref
        .read(businessAnnouncerProvider)
        .announceCall(
          queueNumber: fresh.queueNumber,
          announcementLang: packet.announcementLang,
        );

    setState(() => _flash = fresh);
    _flashTimer?.cancel();
    _flashTimer = Timer(_flashDuration, () {
      if (mounted) setState(() => _flash = null);
    });
  }

  @override
  Widget build(BuildContext context) {
    ref.listen<AsyncValue<BusinessBoardPacket>>(businessBoardProvider, (
      prev,
      next,
    ) {
      final packet = next.value;
      if (packet != null) _handlePacket(packet);
    });

    final async = ref.watch(businessBoardProvider);
    final announcer = ref.watch(businessAnnouncerProvider);
    final scale = boardScaleForSize(MediaQuery.sizeOf(context));

    // Opts out of the app-wide text scaler (tuned for a kiosk read at arm's
    // length): every size here is already `n * scale` against a 1080p TV.
    return MediaQuery.withNoTextScaling(
      child: Scaffold(
        backgroundColor: KioskPalette.bg,
        body: async.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => BusinessBootError(
            error: e,
            what: 'display',
            onRetry: () => ref.invalidate(businessBoardProvider),
            onSetUpAgain: () => deprovision(ref),
          ),
          data: (packet) => _Board(
            packet: packet,
            scale: scale,
            flash: _flash,
            announcer: announcer,
            onDismissFlash: () {
              _flashTimer?.cancel();
              setState(() => _flash = null);
            },
          ),
        ),
      ),
    );
  }
}

class _Board extends StatelessWidget {
  const _Board({
    required this.packet,
    required this.scale,
    required this.flash,
    required this.announcer,
    required this.onDismissFlash,
  });

  final BusinessBoardPacket packet;
  final double scale;
  final BusinessServing? flash;
  final BusinessAnnouncer announcer;
  final VoidCallback onDismissFlash;

  @override
  Widget build(BuildContext context) {
    final ads = packet.showAds ? packet.ads : const <BoardAd>[];
    final hasAds = ads.isNotEmpty;
    final locales = announceLocales(packet.announcementLang);

    // The branch's ticker line plus every active ticker message, joined the way
    // the school board joins them.
    final ticker = packet.showTicker
        ? [
            packet.tickerText,
            ...packet.tickers.map((t) => t.message),
          ].where((s) => s.trim().isNotEmpty).join('   •   ')
        : '';

    return Stack(
      children: [
        Column(
          children: [
            _Header(packet: packet, scale: scale),
            Expanded(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Expanded(
                    // 62 / 38, matching the school board.
                    flex: hasAds ? 62 : 100,
                    child: Padding(
                      padding: EdgeInsets.all(28 * scale),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Expanded(
                            flex: 5,
                            child: _ServingCard(
                              packet: packet,
                              locales: locales,
                              scale: scale,
                            ),
                          ),
                          SizedBox(height: 24 * scale),
                          Expanded(
                            flex: 3,
                            child: _NextUp(
                              packet: packet,
                              locales: locales,
                              scale: scale,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  if (hasAds)
                    Expanded(
                      flex: 38,
                      child: Container(
                        decoration: const BoxDecoration(
                          border: Border(
                            left: BorderSide(color: KioskPalette.border),
                          ),
                        ),
                        child: BoardAdRail(
                          ads: ads,
                          isSpeaking: announcer.isSpeaking,
                        ),
                      ),
                    ),
                ],
              ),
            ),
            BoardTicker(message: ticker, scale: scale),
          ],
        ),
        if (flash != null)
          _CallFlash(
            serving: flash!,
            locales: locales,
            onDismiss: onDismissFlash,
          ),
      ],
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.packet, required this.scale});
  final BusinessBoardPacket packet;
  final double scale;

  @override
  Widget build(BuildContext context) {
    final sub = packet.branchName != packet.title ? packet.branchName : '';
    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: 32 * scale,
        vertical: 14 * scale,
      ),
      decoration: const BoxDecoration(
        color: KioskPalette.surface,
        border: Border(bottom: BorderSide(color: KioskPalette.border)),
      ),
      child: Row(
        children: [
          if (packet.logoUrl.isNotEmpty)
            Padding(
              padding: EdgeInsets.only(right: 18 * scale),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(10 * scale),
                child: Image.network(
                  packet.logoUrl,
                  width: 68 * scale,
                  height: 68 * scale,
                  fit: BoxFit.contain,
                  errorBuilder: (_, _, _) => const SizedBox.shrink(),
                ),
              ),
            ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  packet.title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 44 * scale,
                    fontWeight: FontWeight.w700,
                    height: 1.15,
                    color: KioskPalette.ink,
                  ),
                ),
                if (sub.isNotEmpty)
                  Text(
                    sub,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 22 * scale,
                      color: KioskPalette.inkSoft,
                    ),
                  ),
              ],
            ),
          ),
          if (packet.showClock) BoardClock(scale: scale),
        ],
      ),
    );
  }
}

/// The hero: what is being served right now, as big as the panel allows.
class _ServingCard extends StatelessWidget {
  const _ServingCard({
    required this.packet,
    required this.locales,
    required this.scale,
  });

  final BusinessBoardPacket packet;
  final List<String> locales;
  final double scale;

  @override
  Widget build(BuildContext context) {
    final serving = packet.serving;
    final number = packet.currentServingNumber;

    return Container(
      decoration: BoxDecoration(
        color: KioskPalette.surface,
        borderRadius: BorderRadius.circular(28 * scale),
        border: Border.all(color: KioskPalette.border, width: 1.5),
        boxShadow: KioskPalette.cardShadow,
      ),
      padding: EdgeInsets.symmetric(
        horizontal: 32 * scale,
        vertical: 24 * scale,
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          _BilingualLabel(
            keyOf: (c) => c.nowServing,
            locales: locales,
            scale: scale,
            color: KioskPalette.inkSoft,
          ),
          SizedBox(height: 8 * scale),
          Expanded(
            child: FittedBox(
              fit: BoxFit.scaleDown,
              child: Text(
                number > 0 ? '$number' : '—',
                style: TextStyle(
                  fontSize: 360 * scale,
                  fontWeight: FontWeight.w800,
                  height: 1.0,
                  letterSpacing: -6,
                  color: number > 0
                      ? KioskPalette.accent
                      : KioskPalette.inkFaint,
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
              ),
            ),
          ),
          SizedBox(height: 6 * scale),
          Text(
            serving != null
                ? '${BusinessCopy.of('en').bill} ${serving.billNumber}'
                : BusinessCopy.of(locales.first).waitingForNext,
            textDirection: serving == null && locales.first == 'ar'
                ? TextDirection.rtl
                : null,
            style: TextStyle(
              fontSize: 34 * scale,
              fontWeight: FontWeight.w600,
              color: KioskPalette.inkSoft,
            ),
          ),
        ],
      ),
    );
  }
}

class _NextUp extends StatelessWidget {
  const _NextUp({
    required this.packet,
    required this.locales,
    required this.scale,
  });

  final BusinessBoardPacket packet;
  final List<String> locales;
  final double scale;

  @override
  Widget build(BuildContext context) {
    final next = packet.next;

    return Container(
      decoration: BoxDecoration(
        color: KioskPalette.surface,
        borderRadius: BorderRadius.circular(28 * scale),
        border: Border.all(color: KioskPalette.border, width: 1.5),
      ),
      padding: EdgeInsets.symmetric(
        horizontal: 32 * scale,
        vertical: 22 * scale,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              _BilingualLabel(
                keyOf: (c) => c.nextUp,
                locales: locales,
                scale: scale,
                color: KioskPalette.inkSoft,
                alignStart: true,
              ),
              const Spacer(),
              Text(
                '${packet.waitingCount} ${BusinessCopy.of(locales.first).waiting}',
                textDirection: locales.first == 'ar' ? TextDirection.rtl : null,
                style: TextStyle(
                  fontSize: 26 * scale,
                  fontWeight: FontWeight.w600,
                  color: KioskPalette.inkSoft,
                ),
              ),
            ],
          ),
          SizedBox(height: 16 * scale),
          Expanded(
            child: next.isEmpty
                ? Center(
                    child: Text(
                      BusinessCopy.of(locales.first).noneWaiting,
                      textDirection: locales.first == 'ar'
                          ? TextDirection.rtl
                          : null,
                      style: TextStyle(
                        fontSize: 32 * scale,
                        color: KioskPalette.inkFaint,
                      ),
                    ),
                  )
                : LayoutBuilder(
                    builder: (context, c) {
                      // As many tiles as fit at a legible minimum width; the
                      // rest is the "+N". Tiles then stretch to use the row
                      // (up to a cap), so a full queue fills the panel and a
                      // short one doesn't leave it half empty.
                      final minTile = 150 * scale;
                      final maxTile = 240 * scale;
                      final gap = 16 * scale;
                      final plusW = 90 * scale;
                      var fit = ((c.maxWidth + gap) / (minTile + gap))
                          .floor()
                          .clamp(1, 8);
                      final hiddenIfFit = packet.waitingCount - fit;
                      if (hiddenIfFit > 0) {
                        // Leave room for the "+N" label.
                        fit = ((c.maxWidth - plusW + gap) / (minTile + gap))
                            .floor()
                            .clamp(1, 8);
                      }
                      final shown = next.take(fit).toList();
                      final hidden = packet.waitingCount - shown.length;
                      return Row(
                        children: [
                          for (final e in shown) ...[
                            Flexible(
                              child: ConstrainedBox(
                                constraints: BoxConstraints(maxWidth: maxTile),
                                child: _NextTile(entry: e, scale: scale),
                              ),
                            ),
                            SizedBox(width: gap),
                          ],
                          if (hidden > 0)
                            Text(
                              '+$hidden',
                              style: TextStyle(
                                fontSize: 40 * scale,
                                fontWeight: FontWeight.w700,
                                color: KioskPalette.inkFaint,
                              ),
                            ),
                        ],
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}

class _NextTile extends StatelessWidget {
  const _NextTile({required this.entry, required this.scale});
  final BusinessQueueEntry entry;
  final double scale;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: KioskPalette.surfaceMuted,
        borderRadius: BorderRadius.circular(20 * scale),
      ),
      alignment: Alignment.center,
      padding: EdgeInsets.symmetric(vertical: 12 * scale),
      child: FittedBox(
        fit: BoxFit.scaleDown,
        child: Text(
          '${entry.queueNumber}',
          style: TextStyle(
            fontSize: 80 * scale,
            fontWeight: FontWeight.w800,
            height: 1.0,
            color: KioskPalette.ink,
            fontFeatures: const [FontFeature.tabularFigures()],
          ),
        ),
      ),
    );
  }
}

/// A label in each language the board announces in, English above Arabic, the
/// way the web board stacks them.
class _BilingualLabel extends StatelessWidget {
  const _BilingualLabel({
    required this.keyOf,
    required this.locales,
    required this.scale,
    required this.color,
    this.alignStart = false,
  });

  final String Function(BusinessCopy) keyOf;
  final List<String> locales;
  final double scale;
  final Color color;
  final bool alignStart;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: alignStart
          ? CrossAxisAlignment.start
          : CrossAxisAlignment.center,
      children: [
        for (final l in locales)
          Text(
            l == 'en'
                ? keyOf(BusinessCopy.of(l)).toUpperCase()
                : keyOf(BusinessCopy.of(l)),
            textDirection: l == 'ar' ? TextDirection.rtl : null,
            style: TextStyle(
              fontSize: (l == 'en' ? 26 : 28) * scale,
              fontWeight: FontWeight.w700,
              letterSpacing: l == 'en' ? 5 : 0,
              color: color,
            ),
          ),
      ],
    );
  }
}

/// Full-screen flash for one just-called number.
class _CallFlash extends StatelessWidget {
  const _CallFlash({
    required this.serving,
    required this.locales,
    required this.onDismiss,
  });

  final BusinessServing serving;
  final List<String> locales;
  final VoidCallback onDismiss;

  @override
  Widget build(BuildContext context) {
    return Positioned.fill(
      child: GestureDetector(
        onTap: onDismiss,
        child: Container(
          // Solid, not translucent: the board underneath shows the same number
          // at a similar size, and a see-through scrim ghosts it behind the
          // call.
          color: const Color(0xFF0E1D19),
          alignment: Alignment.center,
          child: LayoutBuilder(
            builder: (context, c) {
              final unit = c.maxHeight / 1080;
              return Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    padding: EdgeInsets.symmetric(
                      horizontal: 38 * unit,
                      vertical: 12 * unit,
                    ),
                    decoration: BoxDecoration(
                      color: KioskPalette.accent,
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: Text(
                      locales.contains('en')
                          ? BusinessCopy.of('en').nowCalling.toUpperCase()
                          : BusinessCopy.of('ar').nowCalling,
                      textDirection: locales.contains('en')
                          ? null
                          : TextDirection.rtl,
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 36 * unit,
                        fontWeight: FontWeight.w900,
                        letterSpacing: locales.contains('en') ? 5 : 0,
                      ),
                    ),
                  ),
                  SizedBox(height: 20 * unit),
                  FittedBox(
                    fit: BoxFit.scaleDown,
                    child: Text(
                      '${serving.queueNumber}',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: (c.maxHeight * 0.46).clamp(120.0, 520.0),
                        fontWeight: FontWeight.w900,
                        height: 1.0,
                        letterSpacing: 6,
                      ),
                    ),
                  ),
                  SizedBox(height: 20 * unit),
                  for (final l in locales)
                    Text(
                      BusinessCopy.of(l).proceed,
                      textDirection: l == 'ar' ? TextDirection.rtl : null,
                      style: TextStyle(
                        color: Colors.white70,
                        fontSize: 46 * unit,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                ],
              );
            },
          ),
        ),
      ),
    );
  }
}
