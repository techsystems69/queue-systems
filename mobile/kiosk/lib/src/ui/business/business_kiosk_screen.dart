import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:wakelock_plus/wakelock_plus.dart';

import '../../api/api_exception.dart';
import '../../config/app_config.dart';
import '../../i18n/business_copy.dart';
import '../../models/business/business_kiosk_bootstrap.dart';
import '../../models/business/business_ticket.dart';
import '../../state/app_auth_providers.dart';
import '../../state/business_providers.dart';
import '../../state/providers.dart';
import '../theme.dart';
import '../widgets/kiosk_header.dart';
import 'business_boot_error.dart';
import 'business_keypad.dart';

/// Longest bill/order number the keypad accepts. The server takes up to 50, but
/// no bill a guest reads off a slip is anywhere near that; capping it keeps a
/// stuck key from filling the field.
const _maxBillLength = 12;

/// How long an untouched half-typed number sits before it is cleared, so the
/// next guest never inherits the last one's digits.
const _idleClear = Duration(seconds: 45);

/// How long the confirmation stays up — long enough to read the number, take
/// the ticket and glance at the board.
const _ticketLinger = Duration(seconds: 9);

/// The hotel / restaurant ticket kiosk. The whole flow is one decision: the guest
/// types the number printed on their bill or order slip, taps *Get my number*,
/// and takes a printed queue ticket. A bill scanner or keyboard works too —
/// digits go into the same field and Enter submits, so a wedge scanner turns the
/// kiosk into scan-and-go.
///
/// Landscape terminal layout: a calm left panel (welcome, what's being served
/// now) and the keypad on the right, the only thing that asks anything of the
/// guest.
class BusinessKioskScreen extends ConsumerStatefulWidget {
  const BusinessKioskScreen({super.key});

  @override
  ConsumerState<BusinessKioskScreen> createState() =>
      _BusinessKioskScreenState();
}

class _BusinessKioskScreenState extends ConsumerState<BusinessKioskScreen> {
  String _lang = 'en';
  bool _langInitialised = false;

  String _bill = '';
  bool _issuing = false;
  String? _error;
  IssuedBusinessTicket? _hero;

  Timer? _resetTimer;
  Timer? _idleTimer;
  Timer? _bootRetry;

  @override
  void initState() {
    super.initState();
    WakelockPlus.enable();
  }

  @override
  void dispose() {
    WakelockPlus.disable();
    _resetTimer?.cancel();
    _idleTimer?.cancel();
    _bootRetry?.cancel();
    super.dispose();
  }

  void _armBootRetry() {
    _bootRetry ??= Timer.periodic(AppConfig.retryInterval, (_) {
      if (mounted) ref.invalidate(businessBootstrapProvider);
    });
  }

  void _cancelBootRetry() {
    _bootRetry?.cancel();
    _bootRetry = null;
  }

  // ── input ───────────────────────────────────────────────────

  void _touched() {
    _idleTimer?.cancel();
    _idleTimer = Timer(_idleClear, () {
      if (mounted && _hero == null) setState(() => _bill = '');
    });
  }

  void _type(String ch) {
    if (_issuing || _hero != null || _bill.length >= _maxBillLength) return;
    setState(() {
      _bill += ch;
      _error = null;
    });
    _touched();
  }

  void _backspace() {
    if (_issuing || _bill.isEmpty) return;
    setState(() {
      _bill = _bill.substring(0, _bill.length - 1);
      _error = null;
    });
    _touched();
  }

  void _clear() {
    if (_issuing) return;
    setState(() {
      _bill = '';
      _error = null;
    });
  }

  /// Hardware keyboard / wedge scanner: printable bill characters, Backspace,
  /// Escape to clear, Enter to submit.
  KeyEventResult _onKey(KeyEvent event, BusinessKioskBootstrap bootstrap) {
    if (event is! KeyDownEvent || _hero != null) return KeyEventResult.ignored;
    final key = event.logicalKey;
    if (key == LogicalKeyboardKey.enter ||
        key == LogicalKeyboardKey.numpadEnter) {
      _submit(bootstrap);
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.backspace) {
      _backspace();
      return KeyEventResult.handled;
    }
    if (key == LogicalKeyboardKey.escape) {
      _clear();
      return KeyEventResult.handled;
    }
    final ch = event.character;
    if (ch != null && RegExp(r'^[A-Za-z0-9\-]$').hasMatch(ch)) {
      _type(ch.toUpperCase());
      return KeyEventResult.handled;
    }
    return KeyEventResult.ignored;
  }

  // ── issuing ─────────────────────────────────────────────────

  Future<void> _submit(BusinessKioskBootstrap bootstrap) async {
    final bill = _bill.trim();
    if (bill.isEmpty || _issuing) return;
    final copy = BusinessCopy.of(_lang);
    setState(() {
      _issuing = true;
      _error = null;
    });
    try {
      final issued = await ref
          .read(businessKioskControllerProvider)
          .issue(bill);
      if (!mounted) return;
      _idleTimer?.cancel();
      setState(() {
        _hero = issued;
        _issuing = false;
        _bill = '';
      });
      _resetTimer?.cancel();
      _resetTimer = Timer(_ticketLinger, _backToEntry);
    } on ApiException catch (e) {
      if (e.isUnregistered) {
        await deprovision(ref);
        return;
      }
      if (mounted) {
        setState(() {
          _issuing = false;
          // A transport failure's text means nothing to a guest; the server's
          // own rejection ("queue is full") does.
          _error = e.isNetwork ? copy.offline : e.message;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _issuing = false;
          _error = copy.offline;
        });
      }
    }
  }

  void _backToEntry() {
    _resetTimer?.cancel();
    if (!mounted) return;
    setState(() {
      _hero = null;
      _bill = '';
      _error = null;
    });
  }

  // ── build ───────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(businessBootstrapProvider);
    return Directionality(
      textDirection: BusinessCopy.of(_lang).isRtl
          ? TextDirection.rtl
          : TextDirection.ltr,
      child: Scaffold(
        backgroundColor: KioskPalette.bg,
        body: SafeArea(
          child: async.when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (e, _) {
              _armBootRetry();
              return BusinessBootError(
                error: e,
                what: 'kiosk',
                onRetry: () => ref.invalidate(businessBootstrapProvider),
                onSetUpAgain: () => deprovision(ref),
              );
            },
            data: (bootstrap) {
              _cancelBootRetry();
              if (!_langInitialised) {
                _langInitialised = true;
                final preferred =
                    ref.read(deviceConfigProvider).value?.defaultLocale ?? '';
                _lang = bootstrap.languages.contains(preferred)
                    ? preferred
                    : bootstrap.languages.first;
              }
              return _shell(bootstrap);
            },
          ),
        ),
      ),
    );
  }

  Widget _shell(BusinessKioskBootstrap bootstrap) {
    final copy = BusinessCopy.of(_lang);
    final feed = ref.watch(businessFeedProvider).value;
    final offline = ref.watch(serverLinkProvider) == ServerLink.offline;
    final lastPrint = ref.watch(lastPrintResultProvider);
    final printFailed = lastPrint?.attempt.isFailure ?? false;

    final allowSelfJoin = feed?.allowSelfJoin ?? bootstrap.allowSelfJoin;
    final serving =
        feed?.currentServingNumber ?? bootstrap.currentServingNumber;
    final waiting = feed?.waitingCount ?? bootstrap.waitingCount;
    final paused = feed?.isPaused ?? bootstrap.isPaused;

    return Focus(
      autofocus: true,
      onKeyEvent: (_, e) => _onKey(e, bootstrap),
      child: Column(
        children: [
          KioskHeader(
            title: bootstrap.title,
            logoUrl: bootstrap.logoUrl,
            // The hero is a decision already made; switching language there
            // would only change the wording on a printed ticket.
            languages: _hero == null ? bootstrap.languages : const [],
            lang: _lang,
            onLangChange: (l) => setState(() => _lang = l),
          ),
          Expanded(
            child: AnimatedSwitcher(
              duration: const Duration(milliseconds: 240),
              switchInCurve: Curves.easeOutCubic,
              child: _hero != null
                  ? _TicketView(
                      key: ValueKey('ticket-${_hero!.ticket.id}'),
                      issued: _hero!,
                      copy: copy,
                      onDone: _backToEntry,
                    )
                  : _EntryView(
                      key: const ValueKey('entry'),
                      title: bootstrap.title,
                      copy: copy,
                      bill: _bill,
                      issuing: _issuing,
                      error: _error,
                      allowSelfJoin: allowSelfJoin,
                      serving: serving,
                      waiting: waiting,
                      paused: paused,
                      onDigit: _type,
                      onBackspace: _backspace,
                      onClear: _clear,
                      onSubmit: () => _submit(bootstrap),
                    ),
            ),
          ),
          // Standing information, not a toast: on screen for everyone who walks
          // up while the server is unreachable, gone the moment a poll succeeds.
          if (offline)
            _StatusBar(text: copy.offline, icon: Icons.wifi_off_rounded),
          if (printFailed)
            _StatusBar(
              text: copy.printFailed,
              icon: Icons.print_disabled_rounded,
            ),
        ],
      ),
    );
  }
}

// ── entry ─────────────────────────────────────────────────────

class _EntryView extends StatelessWidget {
  const _EntryView({
    super.key,
    required this.title,
    required this.copy,
    required this.bill,
    required this.issuing,
    required this.error,
    required this.allowSelfJoin,
    required this.serving,
    required this.waiting,
    required this.paused,
    required this.onDigit,
    required this.onBackspace,
    required this.onClear,
    required this.onSubmit,
  });

  final String title;
  final BusinessCopy copy;
  final String bill;
  final bool issuing;
  final String? error;
  final bool allowSelfJoin;
  final int serving;
  final int waiting;
  final bool paused;
  final ValueChanged<String> onDigit;
  final VoidCallback onBackspace;
  final VoidCallback onClear;
  final VoidCallback onSubmit;

  @override
  Widget build(BuildContext context) {
    final scale = kioskScale(context);
    return LayoutBuilder(
      builder: (context, c) {
        // Side by side whenever the panel is landscape enough to afford it —
        // judged by shape, not width alone: an 800×480 budget terminal is only
        // 800dp wide but far too short to stack a status strip above the keypad.
        final wide = c.maxWidth >= 720 && c.maxWidth >= c.maxHeight * 1.25;
        final info = _InfoPanel(
          title: title,
          copy: copy,
          serving: serving,
          waiting: waiting,
          paused: paused,
          compact: !wide,
          // Only where there's room: on a short panel the keypad needs every
          // pixel of height.
          showSteps: c.maxHeight >= 600,
          scale: scale,
        );
        final pad = _EntryCard(
          copy: copy,
          bill: bill,
          issuing: issuing,
          error: error,
          onDigit: onDigit,
          onBackspace: onBackspace,
          onClear: onClear,
          onSubmit: onSubmit,
          scale: scale,
        );
        final body = allowSelfJoin ? pad : _SelfJoinOff(copy: copy);

        return Padding(
          padding: EdgeInsets.all(24 * scale),
          child: wide
              ? Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Expanded(flex: 5, child: info),
                    SizedBox(width: 24 * scale),
                    Expanded(flex: 6, child: body),
                  ],
                )
              : Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    info,
                    SizedBox(height: 16 * scale),
                    Expanded(child: body),
                  ],
                ),
        );
      },
    );
  }
}

class _InfoPanel extends StatelessWidget {
  const _InfoPanel({
    required this.title,
    required this.copy,
    required this.serving,
    required this.waiting,
    required this.paused,
    required this.compact,
    required this.showSteps,
    required this.scale,
  });

  final String title;
  final BusinessCopy copy;
  final int serving;
  final int waiting;
  final bool paused;
  final bool compact;
  final bool showSteps;
  final double scale;

  @override
  Widget build(BuildContext context) {
    final servingCard = _ServingCard(
      copy: copy,
      serving: serving,
      waiting: waiting,
      compact: compact,
      scale: scale,
    );

    if (compact) return servingCard;

    // The stack (welcome, serving card, steps) is sized for the deployed 1366×768
    // terminal. Scripts with taller line heights (Devanagari, Arabic) or an odd
    // panel can make it a little taller than the space; scaling it down to fit
    // is a graceful failure, overflowing the screen is not.
    return LayoutBuilder(
      builder: (context, c) => Align(
        alignment: AlignmentDirectional.centerStart,
        child: FittedBox(
          fit: BoxFit.scaleDown,
          alignment: AlignmentDirectional.centerStart,
          child: SizedBox(
            width: c.maxWidth,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  copy.welcome,
                  style: TextStyle(
                    fontSize: 52 * scale,
                    fontWeight: FontWeight.w800,
                    letterSpacing: -1.2,
                    height: 1.05,
                    color: KioskPalette.ink,
                  ),
                ),
                SizedBox(height: 8 * scale),
                Text(
                  title,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(fontSize: 22 * scale, color: KioskPalette.inkSoft),
                ),
                SizedBox(height: 34 * scale),
                servingCard,
                if (showSteps) ...[
                  SizedBox(height: 26 * scale),
                  _Steps(copy: copy, scale: scale),
                ],
                if (paused) ...[
                  SizedBox(height: 14 * scale),
                  Container(
                    padding: EdgeInsets.symmetric(
                        horizontal: 16 * scale, vertical: 12 * scale),
                    decoration: BoxDecoration(
                      color: KioskPalette.prioritySoft,
                      borderRadius: BorderRadius.circular(KioskPalette.radiusSm),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.pause_circle_outline_rounded,
                            color: KioskPalette.priority, size: 22 * scale),
                        SizedBox(width: 10 * scale),
                        Flexible(
                          child: Text(copy.paused,
                              style: TextStyle(
                                  fontSize: 16 * scale,
                                  fontWeight: FontWeight.w600,
                                  color: KioskPalette.priority)),
                        ),
                      ],
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// "How this works", in three lines — what happens after the tap, which is the
/// question every first-time guest has standing at a kiosk.
class _Steps extends StatelessWidget {
  const _Steps({required this.copy, required this.scale});
  final BusinessCopy copy;
  final double scale;

  @override
  Widget build(BuildContext context) {
    final steps = [copy.step1, copy.step2, copy.step3];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (var i = 0; i < steps.length; i++)
          Padding(
            padding: EdgeInsets.only(bottom: 12 * scale),
            child: Row(
              children: [
                Container(
                  width: 30 * scale,
                  height: 30 * scale,
                  alignment: Alignment.center,
                  decoration: const BoxDecoration(
                    color: KioskPalette.primarySoft,
                    shape: BoxShape.circle,
                  ),
                  child: Text(
                    '${i + 1}',
                    style: TextStyle(
                      fontSize: 15 * scale,
                      fontWeight: FontWeight.w700,
                      color: KioskPalette.primary,
                    ),
                  ),
                ),
                SizedBox(width: 14 * scale),
                Flexible(
                  child: Text(
                    steps[i],
                    style: TextStyle(
                      fontSize: 17 * scale,
                      color: KioskPalette.inkSoft,
                    ),
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }
}

class _ServingCard extends StatelessWidget {
  const _ServingCard({
    required this.copy,
    required this.serving,
    required this.waiting,
    required this.compact,
    required this.scale,
  });

  final BusinessCopy copy;
  final int serving;
  final int waiting;
  final bool compact;
  final double scale;

  @override
  Widget build(BuildContext context) {
    final label = Text(
      copy.nowServing.toUpperCase(),
      style: TextStyle(
        fontSize: 13 * scale,
        fontWeight: FontWeight.w700,
        letterSpacing: 1.6,
        color: KioskPalette.inkSoft,
      ),
    );
    final number = Text(
      serving > 0 ? '$serving' : '—',
      style: TextStyle(
        fontSize: (compact ? 44 : 96) * scale,
        fontWeight: FontWeight.w800,
        height: 1.0,
        letterSpacing: -2,
        color: KioskPalette.primary,
        fontFeatures: const [FontFeature.tabularFigures()],
      ),
    );
    final waitingChip = Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(
          Icons.people_alt_outlined,
          size: 20 * scale,
          color: KioskPalette.inkSoft,
        ),
        SizedBox(width: 8 * scale),
        Text(
          '$waiting ${copy.waiting}',
          style: TextStyle(
            fontSize: 17 * scale,
            fontWeight: FontWeight.w600,
            color: KioskPalette.inkSoft,
          ),
        ),
      ],
    );

    return Container(
      padding: EdgeInsets.all((compact ? 16 : 26) * scale),
      decoration: BoxDecoration(
        color: KioskPalette.surface,
        borderRadius: BorderRadius.circular(KioskPalette.radius),
        border: Border.all(color: KioskPalette.border),
        boxShadow: KioskPalette.hairShadow,
      ),
      child: compact
          ? Row(
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [label, number],
                ),
                const Spacer(),
                waitingChip,
              ],
            )
          : Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                label,
                SizedBox(height: 10 * scale),
                number,
                SizedBox(height: 18 * scale),
                const Divider(),
                SizedBox(height: 14 * scale),
                waitingChip,
              ],
            ),
    );
  }
}

class _EntryCard extends StatelessWidget {
  const _EntryCard({
    required this.copy,
    required this.bill,
    required this.issuing,
    required this.error,
    required this.onDigit,
    required this.onBackspace,
    required this.onClear,
    required this.onSubmit,
    required this.scale,
  });

  final BusinessCopy copy;
  final String bill;
  final bool issuing;
  final String? error;
  final ValueChanged<String> onDigit;
  final VoidCallback onBackspace;
  final VoidCallback onClear;
  final VoidCallback onSubmit;
  final double scale;

  @override
  Widget build(BuildContext context) {
    final canSubmit = bill.isNotEmpty && !issuing;

    return Container(
      padding: EdgeInsets.all(22 * scale),
      decoration: BoxDecoration(
        color: KioskPalette.surface,
        borderRadius: BorderRadius.circular(KioskPalette.radius + 4),
        border: Border.all(color: KioskPalette.border),
        boxShadow: KioskPalette.cardShadow,
      ),
      child: LayoutBuilder(
        builder: (context, c) {
          // A short panel (a 480dp-high budget terminal) can't afford the hint
          // line or the generous gaps; drop them so the keypad — which takes
          // whatever height is left — keeps finger-sized keys and the button
          // stays on screen.
          final dense = c.maxHeight < 440;
          final gap = (dense ? 8.0 : 16.0) * scale;

          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                copy.prompt,
                textAlign: TextAlign.center,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: (dense ? 20 : 26) * scale,
                  fontWeight: FontWeight.w700,
                  color: KioskPalette.ink,
                ),
              ),
              if (!dense) ...[
                SizedBox(height: 4 * scale),
                Text(
                  copy.promptHint,
                  textAlign: TextAlign.center,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 15 * scale,
                    color: KioskPalette.inkSoft,
                  ),
                ),
              ],
              SizedBox(height: gap),
              _BillField(value: bill, scale: scale, dense: dense),
              if (error != null) ...[
                SizedBox(height: gap / 2),
                Container(
                  padding: EdgeInsets.symmetric(
                    horizontal: 14 * scale,
                    vertical: (dense ? 6 : 10) * scale,
                  ),
                  decoration: BoxDecoration(
                    color: KioskPalette.dangerSoft,
                    borderRadius: BorderRadius.circular(KioskPalette.radiusSm),
                  ),
                  child: Text(
                    error!,
                    textAlign: TextAlign.center,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: (dense ? 13 : 15) * scale,
                      fontWeight: FontWeight.w600,
                      color: KioskPalette.danger,
                    ),
                  ),
                ),
              ],
              SizedBox(height: gap),
              Expanded(
                child: BusinessKeypad(
                  gap: dense ? 8 : 12,
                  clearLabel: copy.clear,
                  onDigit: onDigit,
                  onBackspace: onBackspace,
                  onClear: onClear,
                ),
              ),
              SizedBox(height: gap),
              SizedBox(
                height: (dense ? 50 : 62) * scale,
                child: FilledButton(
                  onPressed: canSubmit ? onSubmit : null,
                  child: issuing
                      ? Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            const SizedBox(
                              width: 22,
                              height: 22,
                              child: CircularProgressIndicator(
                                strokeWidth: 2.4,
                                color: Colors.white,
                              ),
                            ),
                            const SizedBox(width: 12),
                            Text(copy.issuing),
                          ],
                        )
                      : Text(
                          copy.getNumber,
                          style: TextStyle(fontSize: 20 * scale),
                        ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

/// The number being typed. Shows a placeholder dash while empty so the field
/// reads as "waiting for you" rather than broken.
class _BillField extends StatelessWidget {
  const _BillField({
    required this.value,
    required this.scale,
    this.dense = false,
  });
  final String value;
  final double scale;
  final bool dense;

  @override
  Widget build(BuildContext context) {
    final empty = value.isEmpty;
    return Container(
      height: (dense ? 54 : 84) * scale,
      alignment: Alignment.center,
      padding: EdgeInsets.symmetric(horizontal: 16 * scale),
      decoration: BoxDecoration(
        color: KioskPalette.surfaceMuted,
        borderRadius: BorderRadius.circular(KioskPalette.radiusSm + 2),
        border: Border.all(
          color: empty ? KioskPalette.border : KioskPalette.primary,
          width: empty ? 1.2 : 2,
        ),
      ),
      child: FittedBox(
        fit: BoxFit.scaleDown,
        child: Text(
          empty ? '—' : value,
          style: TextStyle(
            fontSize: (dense ? 32 : 46) * scale,
            fontWeight: FontWeight.w800,
            letterSpacing: empty ? 0 : 6,
            color: empty ? KioskPalette.inkFaint : KioskPalette.ink,
            fontFeatures: const [FontFeature.tabularFigures()],
          ),
        ),
      ),
    );
  }
}

class _SelfJoinOff extends StatelessWidget {
  const _SelfJoinOff({required this.copy});
  final BusinessCopy copy;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(32),
      decoration: BoxDecoration(
        color: KioskPalette.surface,
        borderRadius: BorderRadius.circular(KioskPalette.radius + 4),
        border: Border.all(color: KioskPalette.border),
      ),
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(
              Icons.support_agent_rounded,
              size: 56,
              color: KioskPalette.inkFaint,
            ),
            const SizedBox(height: 16),
            Text(
              copy.selfJoinOff,
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 24,
                fontWeight: FontWeight.w600,
                height: 1.35,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ── confirmation ──────────────────────────────────────────────

class _TicketView extends StatelessWidget {
  const _TicketView({
    super.key,
    required this.issued,
    required this.copy,
    required this.onDone,
  });

  final IssuedBusinessTicket issued;
  final BusinessCopy copy;
  final VoidCallback onDone;

  @override
  Widget build(BuildContext context) {
    final scale = kioskScale(context);
    final BusinessTicket ticket = issued.ticket;
    final ahead = issued.waitingAhead;

    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      // Anyone who is done sooner taps anywhere — the next guest is waiting.
      onTap: onDone,
      child: Center(
        child: Padding(
          padding: EdgeInsets.all(24 * scale),
          child: FittedBox(
            fit: BoxFit.scaleDown,
            child: SizedBox(
              width: 720 * scale,
              child: Container(
                padding: EdgeInsets.fromLTRB(
                  40 * scale,
                  34 * scale,
                  40 * scale,
                  28 * scale,
                ),
                decoration: BoxDecoration(
                  color: KioskPalette.surface,
                  borderRadius: BorderRadius.circular(KioskPalette.radius + 8),
                  border: Border.all(color: KioskPalette.border),
                  boxShadow: KioskPalette.cardShadow,
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      padding: EdgeInsets.symmetric(
                        horizontal: 14 * scale,
                        vertical: 6 * scale,
                      ),
                      decoration: BoxDecoration(
                        color: KioskPalette.successSoft,
                        borderRadius: BorderRadius.circular(
                          KioskPalette.radiusPill,
                        ),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            Icons.check_circle_rounded,
                            size: 20 * scale,
                            color: KioskPalette.success,
                          ),
                          SizedBox(width: 8 * scale),
                          Text(
                            copy.yourNumber.toUpperCase(),
                            style: TextStyle(
                              fontSize: 14 * scale,
                              fontWeight: FontWeight.w700,
                              letterSpacing: 1.4,
                              color: KioskPalette.success,
                            ),
                          ),
                        ],
                      ),
                    ),
                    SizedBox(height: 10 * scale),
                    Text(
                      '${ticket.queueNumber}',
                      style: TextStyle(
                        fontSize: 190 * scale,
                        fontWeight: FontWeight.w800,
                        height: 1.0,
                        letterSpacing: -4,
                        color: KioskPalette.primary,
                        fontFeatures: const [FontFeature.tabularFigures()],
                      ),
                    ),
                    Text(
                      '${copy.bill} ${ticket.billNumber}',
                      style: TextStyle(
                        fontSize: 26 * scale,
                        fontWeight: FontWeight.w600,
                        color: KioskPalette.inkSoft,
                      ),
                    ),
                    if (ahead != null) ...[
                      SizedBox(height: 20 * scale),
                      Container(
                        width: double.infinity,
                        padding: EdgeInsets.symmetric(vertical: 14 * scale),
                        decoration: BoxDecoration(
                          color: KioskPalette.primarySoft,
                          borderRadius: BorderRadius.circular(
                            KioskPalette.radiusSm,
                          ),
                        ),
                        child: Text(
                          copy.ahead(ahead),
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            fontSize: 22 * scale,
                            fontWeight: FontWeight.w700,
                            color: KioskPalette.primary,
                          ),
                        ),
                      ),
                    ],
                    SizedBox(height: 18 * scale),
                    Text(
                      copy.keepTicket,
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 19 * scale,
                        height: 1.35,
                        color: KioskPalette.inkSoft,
                      ),
                    ),
                    SizedBox(height: 22 * scale),
                    // The wait made visible: the bar drains over exactly the
                    // time the screen will stay up, so it never looks like an
                    // arbitrary hold.
                    ClipRRect(
                      borderRadius: BorderRadius.circular(4),
                      child: TweenAnimationBuilder<double>(
                        tween: Tween(begin: 1, end: 0),
                        duration: _ticketLinger,
                        builder: (_, v, _) => LinearProgressIndicator(
                          value: v,
                          minHeight: 6,
                          backgroundColor: KioskPalette.surfaceMuted,
                          color: KioskPalette.primary,
                        ),
                      ),
                    ),
                    SizedBox(height: 16 * scale),
                    TextButton(onPressed: onDone, child: Text(copy.done)),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _StatusBar extends StatelessWidget {
  const _StatusBar({required this.text, required this.icon});
  final String text;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
      color: KioskPalette.danger,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(icon, color: Colors.white, size: 20),
          const SizedBox(width: 10),
          Flexible(
            child: Text(
              text,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 16,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
