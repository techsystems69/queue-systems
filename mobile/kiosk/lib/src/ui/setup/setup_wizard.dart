import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/api_exception.dart';
import '../../api/app_api.dart';
import '../../config/app_config.dart';
import '../../config/device_config.dart';
import '../../models/app_service.dart';
import '../../printing/printer_settings.dart';
import '../../state/app_auth_providers.dart';
import '../../state/providers.dart';
import '../theme.dart';
import 'login_step.dart';
import 'pin_step.dart';
import 'printer_setup_step.dart';
import 'service_step.dart';

enum _Step { signIn, service, printer, pin }

/// Everything the flow needs from the server, however it got it (a fresh sign-in
/// or a re-fetch with a stored session).
class _Catalog {
  _Catalog({
    required this.profile,
    required this.branches,
    required this.services,
  });
  final AppProfileSummary profile;
  final List<AppBranch> branches;
  final List<AppService> services;
}

/// Device setup, in as few steps as the situation allows:
///
///   sign in → **choose a service** → (printer, kiosks with none yet) → (PIN,
///   devices with none yet) → running.
///
/// There is no pairing code and no role/facility wizard: the account's tenant
/// decides the product, and the server's service catalog decides what the device
/// can become. A device that already has a printer and PIN goes straight from the
/// choice to running.
///
/// With [changeMode] (opened from Settings) it starts at the choice using the
/// stored session, leaves the running device untouched until a new service is
/// actually picked, and can be closed to keep things as they were.
class SetupWizard extends ConsumerStatefulWidget {
  const SetupWizard({super.key, this.changeMode = false});
  final bool changeMode;

  @override
  ConsumerState<SetupWizard> createState() => _SetupWizardState();
}

class _SetupWizardState extends ConsumerState<SetupWizard> {
  final _baseUrl = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();

  late final DeviceConfig _initial;
  late PrinterSettings _printer;
  String? _pinHash;
  String? _pinSalt;
  late int _pinLength;

  _Catalog? _catalog;
  _Step _step = _Step.signIn;
  AppService? _service;

  /// Resolving a stored session before deciding which screen to open.
  bool _booting = true;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _initial = ref.read(deviceConfigProvider).requireValue;
    _baseUrl.text = _initial.baseUrl.isEmpty ? AppConfig.defaultBaseUrl : _initial.baseUrl;
    _printer = _initial.printer;
    _pinHash = _initial.adminPinHash;
    _pinSalt = _initial.adminPinSalt;
    _pinLength = _initial.adminPinLength;
    _resumeSession();
  }

  @override
  void dispose() {
    _baseUrl.dispose();
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  /// A stored session means the operator already signed in on this device:
  /// fetch the catalog with it and skip the password. Any failure (expired,
  /// offline) just lands on the sign-in screen — never a dead end.
  Future<void> _resumeSession() async {
    try {
      final session = await ref.read(authSessionProvider.future);
      if (session != null) {
        final p = await ref.read(appApiProvider).provision();
        if (!mounted) return;
        setState(() {
          _catalog = _Catalog(
            profile: p.profile,
            branches: p.branches,
            services: p.services,
          );
          _step = _Step.service;
        });
      }
    } catch (_) {
      // fall through to sign-in
    }
    if (mounted) setState(() => _booting = false);
  }

  // ── flow ────────────────────────────────────────────────────

  bool get _needsPrinter =>
      _service?.kind == AppServiceKind.kiosk && !_initial.printer.isConfigured;
  bool get _needsPin => !_initial.hasPin;

  List<_Step> get _flow => [
        _Step.signIn,
        _Step.service,
        if (_needsPrinter) _Step.printer,
        if (_needsPin) _Step.pin,
      ];

  bool get _isLast => _flow.last == _step;

  void _advance() {
    if (_isLast) {
      _finish();
      return;
    }
    setState(() => _step = _flow[_flow.indexOf(_step) + 1]);
  }

  void _back() {
    final i = _flow.indexOf(_step);
    if (i > _flow.indexOf(_Step.service)) setState(() => _step = _flow[i - 1]);
  }

  void _select(AppService s) {
    setState(() => _service = s);
    _advance();
  }

  bool get _canAdvance => switch (_step) {
        _Step.pin => _pinHash != null,
        _ => true,
      };

  String get _startLabel => switch (_service?.kind) {
        AppServiceKind.kiosk => 'Start kiosk',
        AppServiceKind.display => 'Start display',
        _ => 'Open screen',
      };

  // ── actions ─────────────────────────────────────────────────

  Future<void> _login() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    final url = _baseUrl.text.trim();
    // A transient client on the URL typed a moment ago: the saved
    // DeviceConfig.baseUrl (which appApiProvider reads) isn't updated until the
    // sign-in has actually worked.
    final api = ref.read(appApiFactoryProvider)(url);
    try {
      final result = await api.login(email: _email.text, password: _password.text);
      await ref.read(authSessionProvider.notifier).signIn(result);
      // Persist the server now: creating a display and every later call go
      // through appApiProvider, which reads it from the saved config.
      final cfg = ref.read(deviceConfigProvider).requireValue;
      await ref.read(deviceConfigProvider.notifier).save(cfg.copyWith(baseUrl: url));
      if (!mounted) return;
      _password.clear();
      setState(() {
        _catalog = _Catalog(
          profile: result.profile,
          branches: result.branches,
          services: result.services,
        );
        _service = null;
        _step = _Step.service;
        _busy = false;
      });
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          _error = e.message;
          _busy = false;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _error = 'Could not reach the server.';
          _busy = false;
        });
      }
    }
  }

  Future<AppService> _createDisplay(AppBranch branch, String name) async {
    final service =
        await ref.read(appApiProvider).createDisplay(branchId: branch.id, name: name);
    if (mounted) setState(() => _catalog?.services.add(service));
    return service;
  }

  Future<void> _useDifferentAccount() async {
    await ref.read(authSessionProvider.notifier).signOut();
    if (!mounted) return;
    setState(() {
      _catalog = null;
      _service = null;
      _error = null;
      _step = _Step.signIn;
    });
  }

  Future<void> _finish() async {
    final svc = _service;
    final catalog = _catalog;
    if (svc == null || catalog == null) return;
    final base = _baseUrl.text.trim();
    final cfg = ref.read(deviceConfigProvider).requireValue;
    await ref.read(deviceConfigProvider.notifier).save(cfg.copyWith(
          baseUrl: base,
          role: svc.role,
          vertical: catalog.profile.vertical,
          setupComplete: true,
          branchToken: svc.kind == AppServiceKind.kiosk ? svc.token : '',
          branchId: svc.branchId,
          screenToken: svc.kind == AppServiceKind.display ? svc.token : '',
          webUrl: svc.kind == AppServiceKind.web ? svc.webUrl(base) : '',
          adminPinHash: _pinHash,
          adminPinSalt: _pinSalt,
          adminPinLength: _pinLength,
          printer: _printer,
          serviceId: svc.id,
          serviceTitle: svc.title,
        ));
    if (mounted) Navigator.of(context).popUntil((r) => r.isFirst);
  }

  // ── build ───────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    if (_booting) {
      return const Scaffold(
        backgroundColor: KioskPalette.bg,
        body: Center(child: CircularProgressIndicator()),
      );
    }

    if (_step == _Step.signIn) {
      return Scaffold(
        backgroundColor: KioskPalette.surface,
        body: LoginStep(
          emailController: _email,
          passwordController: _password,
          baseUrlController: _baseUrl,
          busy: _busy,
          error: _error,
          onSubmit: _login,
          allowServerEdit: !widget.changeMode,
        ),
      );
    }

    final catalog = _catalog!;
    final stepper = _flow.where((s) => s != _Step.signIn).toList();
    final showBottom = _step != _Step.service;

    return Scaffold(
      backgroundColor: KioskPalette.bg,
      resizeToAvoidBottomInset: true,
      body: SafeArea(
        child: Column(
          children: [
            _TopBar(
              steps: stepper,
              current: _step,
              account: catalog.profile.email,
              onDifferentAccount:
                  widget.changeMode ? null : _useDifferentAccount,
              onClose: widget.changeMode
                  ? () => Navigator.of(context).pop()
                  : null,
            ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 32),
                child: AnimatedSwitcher(
                  duration: const Duration(milliseconds: 200),
                  child: KeyedSubtree(
                    key: ValueKey(_step),
                    child: _content(catalog),
                  ),
                ),
              ),
            ),
            if (showBottom)
              Padding(
                padding: const EdgeInsets.fromLTRB(32, 8, 32, 22),
                child: Row(
                  children: [
                    OutlinedButton(onPressed: _back, child: const Text('Back')),
                    const Spacer(),
                    FilledButton(
                      onPressed: _canAdvance ? _advance : null,
                      child: Text(_isLast ? _startLabel : 'Next'),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _content(_Catalog catalog) {
    switch (_step) {
      case _Step.service:
        return ServicePickerStep(
          customerName: catalog.profile.customerName,
          vertical: catalog.profile.vertical,
          branches: catalog.branches,
          services: catalog.services,
          currentServiceId: _initial.serviceId,
          onSelect: _select,
          onCreateDisplay: _createDisplay,
        );
      case _Step.printer:
        return PrinterSetupStep(
          value: _printer,
          onChanged: (p) => setState(() => _printer = p),
        );
      case _Step.pin:
        return PinSetupStep(
          length: _pinLength,
          onLengthChanged: (l) => setState(() => _pinLength = l),
          onPinCreated: (hash, salt) => setState(() {
            _pinHash = hash;
            _pinSalt = salt;
          }),
          alreadySet: _pinHash != null,
        );
      case _Step.signIn:
        return const SizedBox.shrink();
    }
  }
}

class _TopBar extends StatelessWidget {
  const _TopBar({
    required this.steps,
    required this.current,
    required this.account,
    required this.onDifferentAccount,
    required this.onClose,
  });

  final List<_Step> steps;
  final _Step current;
  final String account;
  final VoidCallback? onDifferentAccount;
  final VoidCallback? onClose;

  static String _label(_Step s) => switch (s) {
        _Step.signIn => 'Sign in',
        _Step.service => 'Service',
        _Step.printer => 'Printer',
        _Step.pin => 'PIN',
      };

  @override
  Widget build(BuildContext context) {
    final currentIndex = steps.indexOf(current);
    final stepper = Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (var i = 0; i < steps.length; i++) ...[
          _StepPill(
            label: _label(steps[i]),
            index: i + 1,
            active: i == currentIndex,
            done: i < currentIndex,
          ),
          if (i != steps.length - 1)
            Container(
              width: 22,
              height: 2,
              margin: const EdgeInsets.symmetric(horizontal: 6),
              color: i < currentIndex ? KioskPalette.primary : KioskPalette.border,
            ),
        ],
      ],
    );

    return Container(
      padding: const EdgeInsets.fromLTRB(32, 14, 20, 14),
      decoration: const BoxDecoration(
        color: KioskPalette.surface,
        border: Border(bottom: BorderSide(color: KioskPalette.border)),
      ),
      child: LayoutBuilder(
        builder: (context, c) {
          // On a 1024dp panel or narrower the title gives way first, then the
          // account line; the stepper shrinks rather than overflow.
          final showTitle = c.maxWidth >= 900;
          final showAccount = c.maxWidth >= 700;
          return Row(
            children: [
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(
                  color: KioskPalette.primary,
                  borderRadius: BorderRadius.circular(11),
                ),
                child: const Icon(Icons.confirmation_number_outlined,
                    color: Colors.white, size: 20),
              ),
              if (showTitle) ...[
                const SizedBox(width: 12),
                const Text('Set up this device',
                    style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
              ],
              const SizedBox(width: 24),
              Flexible(
                child: FittedBox(
                  fit: BoxFit.scaleDown,
                  alignment: AlignmentDirectional.centerStart,
                  child: stepper,
                ),
              ),
              const Spacer(),
              if (showAccount)
                Flexible(
                  child: Text(account,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                          color: KioskPalette.inkSoft, fontSize: 14)),
                ),
              if (onDifferentAccount != null)
                TextButton(
                    onPressed: onDifferentAccount,
                    child: const Text('Switch account')),
              if (onClose != null)
                IconButton(
                  tooltip: 'Keep the current setup',
                  icon: const Icon(Icons.close_rounded),
                  onPressed: onClose,
                ),
            ],
          );
        },
      ),
    );
  }
}

class _StepPill extends StatelessWidget {
  const _StepPill({
    required this.label,
    required this.index,
    required this.active,
    required this.done,
  });
  final String label;
  final int index;
  final bool active;
  final bool done;

  @override
  Widget build(BuildContext context) {
    final on = active || done;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        CircleAvatar(
          radius: 12,
          backgroundColor: active
              ? KioskPalette.primary
              : (done ? KioskPalette.primarySoft : KioskPalette.surfaceMuted),
          child: done
              ? const Icon(Icons.check, size: 14, color: KioskPalette.primary)
              : Text('$index',
                  style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      color: active ? Colors.white : KioskPalette.inkFaint)),
        ),
        const SizedBox(width: 8),
        Text(label,
            style: TextStyle(
                fontSize: 14,
                fontWeight: active ? FontWeight.w700 : FontWeight.w500,
                color: on ? KioskPalette.ink : KioskPalette.inkFaint)),
      ],
    );
  }
}
