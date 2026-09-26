import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/api_exception.dart';
import '../../api/app_api.dart';
import '../../config/auth_session.dart';
import '../../config/device_config.dart';
import '../../config/device_role.dart';
import '../../config/device_vertical.dart';
import '../../state/app_auth_providers.dart';
import '../../state/providers.dart';
import '../setup/pin_step.dart';
import '../setup/setup_wizard.dart';
import '../setup/printer_setup_step.dart';
import '../theme.dart';
import 'tenant_settings_form.dart';

/// The device Settings screen — reached through [AdminGate]'s PIN, replacing the
/// old "re-open the setup wizard" behaviour. Device-local settings (printer,
/// PIN, kiosk language, server URL) plus the tenant's server-side settings for
/// this facility. The setup wizard is now first-run / full re-provision only.
class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final cfg = ref.watch(deviceConfigProvider).value;
    final session = ref.watch(authSessionProvider).value;

    return Scaffold(
      backgroundColor: KioskPalette.bg,
      appBar: AppBar(
        title: const Text('Device settings'),
        backgroundColor: KioskPalette.surface,
      ),
      body: cfg == null
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 40),
              children: [
                _AccountSection(cfg: cfg, session: session),
                const SizedBox(height: 12),
                _DeviceSection(cfg: cfg),
                if (cfg.role == DeviceRole.kiosk) ...[
                  const SizedBox(height: 12),
                  _PrinterSection(cfg: cfg),
                  const SizedBox(height: 12),
                  _KioskLanguageSection(cfg: cfg),
                ],
                const SizedBox(height: 12),
                _PinSection(cfg: cfg),
                if (cfg.role != DeviceRole.web &&
                    cfg.vertical != DeviceVertical.business) ...[
                  const SizedBox(height: 12),
                  _TenantSettingsSection(cfg: cfg, session: session),
                ],
                const SizedBox(height: 12),
                _AdvancedSection(cfg: cfg),
              ],
            ),
    );
  }
}

class _Section extends StatelessWidget {
  const _Section({required this.title, required this.child, this.icon});
  final String title;
  final Widget child;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    return Card(
      color: KioskPalette.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: const BorderSide(color: KioskPalette.border),
      ),
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                if (icon != null) ...[
                  Icon(icon, size: 18, color: KioskPalette.inkSoft),
                  const SizedBox(width: 8),
                ],
                Text(title,
                    style: const TextStyle(
                        fontWeight: FontWeight.w700, fontSize: 16)),
              ],
            ),
            const SizedBox(height: 14),
            child,
          ],
        ),
      ),
    );
  }
}

class _AccountSection extends ConsumerWidget {
  const _AccountSection({required this.cfg, required this.session});
  final DeviceConfig cfg;
  final AuthSession? session;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = session;
    return _Section(
      title: 'Account',
      icon: Icons.person_outline,
      child: s == null
          ? Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Not signed in. The device keeps running on its saved token; '
                  'sign in to change the facility or edit settings.',
                  style: TextStyle(color: KioskPalette.inkSoft),
                ),
                const SizedBox(height: 12),
                FilledButton(
                  onPressed: () => _reSignIn(context, ref, cfg),
                  child: const Text('Sign in'),
                ),
              ],
            )
          : Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _kv('Signed in as', s.email),
                _kv('Organisation', s.customerName),
                _kv('Product', s.vertical.label),
                const SizedBox(height: 12),
                OutlinedButton.icon(
                  icon: const Icon(Icons.logout),
                  label: const Text('Sign out'),
                  onPressed: () async {
                    final ok = await _confirm(context, 'Sign out?',
                        'This unprovisions the device and returns to setup.');
                    if (ok && context.mounted) {
                      await deprovision(ref);
                      if (context.mounted) {
                        Navigator.of(context).popUntil((r) => r.isFirst);
                      }
                    }
                  },
                ),
              ],
            ),
    );
  }
}

class _DeviceSection extends ConsumerWidget {
  const _DeviceSection({required this.cfg});
  final DeviceConfig cfg;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return _Section(
      title: 'This device',
      icon: Icons.devices_other_outlined,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _kv('Showing',
              cfg.serviceTitle.isNotEmpty ? cfg.serviceTitle : (cfg.role?.label ?? '—')),
          _kv('Type', cfg.role?.label ?? '—'),
          _kv('Product', cfg.vertical.label),
          if (cfg.role == DeviceRole.web) _kv('Page', cfg.webUrl),
          const SizedBox(height: 14),
          FilledButton.icon(
            icon: const Icon(Icons.swap_horiz_rounded),
            label: const Text('Change what this device shows'),
            // Opens the same "choose a service" screen as first-run, but leaves
            // the running device alone until a new service is actually picked —
            // closing it keeps everything as it was.
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute(
                fullscreenDialog: true,
                builder: (_) => const SetupWizard(changeMode: true),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _PrinterSection extends ConsumerWidget {
  const _PrinterSection({required this.cfg});
  final DeviceConfig cfg;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return _Section(
      title: 'Printer',
      icon: Icons.print_outlined,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _kv(
              'Status',
              cfg.printer.isConfigured
                  ? '${cfg.printer.transport.label} · ${cfg.printer.paper.label}'
                  : 'Not configured'),
          const SizedBox(height: 10),
          OutlinedButton(
            onPressed: () => _pushEditor(
              context,
              'Printer',
              (setValue) => PrinterSetupStep(
                value: cfg.printer,
                onChanged: (p) {
                  ref
                      .read(deviceConfigProvider.notifier)
                      .save(cfg.copyWith(printer: p));
                },
              ),
            ),
            child: const Text('Configure printer'),
          ),
        ],
      ),
    );
  }
}

class _PinSection extends ConsumerWidget {
  const _PinSection({required this.cfg});
  final DeviceConfig cfg;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return _Section(
      title: 'Admin PIN',
      icon: Icons.pin_outlined,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _kv('Status', cfg.hasPin ? 'Set' : 'Not set'),
          const SizedBox(height: 10),
          OutlinedButton(
            onPressed: () => _pushEditor(
              context,
              'Admin PIN',
              (_) => PinSetupStep(
                length: cfg.adminPinLength,
                alreadySet: cfg.hasPin,
                onLengthChanged: (l) => ref
                    .read(deviceConfigProvider.notifier)
                    .save(cfg.copyWith(adminPinLength: l)),
                onPinCreated: (hash, salt) {
                  ref.read(deviceConfigProvider.notifier).save(
                      cfg.copyWith(adminPinHash: hash, adminPinSalt: salt));
                },
              ),
            ),
            child: Text(cfg.hasPin ? 'Change PIN' : 'Set a PIN'),
          ),
        ],
      ),
    );
  }
}

void _pushEditor(
  BuildContext context,
  String title,
  Widget Function(void Function() rebuild) body,
) {
  Navigator.of(context).push(
    MaterialPageRoute(
      builder: (_) => Scaffold(
        appBar: AppBar(title: Text(title)),
        body: Padding(
          padding: const EdgeInsets.all(20),
          child: StatefulBuilder(
            builder: (_, setState) => body(() => setState(() {})),
          ),
        ),
      ),
    ),
  );
}

class _KioskLanguageSection extends ConsumerWidget {
  const _KioskLanguageSection({required this.cfg});
  final DeviceConfig cfg;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final langs = ref.watch(bootstrapProvider).value?.settings?.languages ??
        const <String>['en'];
    final value = cfg.defaultLocale.isEmpty ? null : cfg.defaultLocale;
    return _Section(
      title: 'Kiosk language',
      icon: Icons.translate_outlined,
      child: DropdownButtonFormField<String?>(
        initialValue: value,
        decoration: const InputDecoration(
          labelText: 'Default language',
          helperText: 'Falls back to the first configured language when unset.',
        ),
        items: [
          const DropdownMenuItem<String?>(value: null, child: Text('Server default')),
          for (final l in langs)
            DropdownMenuItem<String?>(value: l, child: Text(l.toUpperCase())),
        ],
        onChanged: (v) => ref
            .read(deviceConfigProvider.notifier)
            .save(cfg.copyWith(defaultLocale: v ?? '')),
      ),
    );
  }
}

class _TenantSettingsSection extends ConsumerWidget {
  const _TenantSettingsSection({required this.cfg, required this.session});
  final DeviceConfig cfg;
  final AuthSession? session;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (cfg.branchId.isEmpty) {
      return _Section(
        title: 'Facility settings',
        icon: Icons.tune_outlined,
        child: const Text(
          'Re-provision the device (Advanced) to link it to a facility, then '
          'these settings become editable here.',
          style: TextStyle(color: KioskPalette.inkSoft),
        ),
      );
    }
    if (session == null) {
      return _Section(
        title: 'Facility settings',
        icon: Icons.tune_outlined,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Sign in to view and edit facility settings.',
                style: TextStyle(color: KioskPalette.inkSoft)),
            const SizedBox(height: 12),
            FilledButton(
              onPressed: () => _reSignIn(context, ref, cfg),
              child: const Text('Sign in'),
            ),
          ],
        ),
      );
    }

    final async = ref.watch(tenantSettingsProvider(cfg.branchId));
    return _Section(
      title: 'Facility settings',
      icon: Icons.tune_outlined,
      child: async.when(
        loading: () => const Padding(
          padding: EdgeInsets.symmetric(vertical: 12),
          child: Center(child: CircularProgressIndicator()),
        ),
        error: (e, _) => _errorBody(context, ref, cfg, e),
        data: (settings) => TenantSettingsForm(
          vertical: cfg.vertical,
          settings: settings,
          onSave: (patch) async {
            try {
              await ref
                  .read(appApiProvider)
                  .saveSettings(branchId: cfg.branchId, patch: patch);
              ref.invalidate(tenantSettingsProvider(cfg.branchId));
              if (context.mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Settings saved.')));
              }
            } on ApiException catch (err) {
              if (context.mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text(err.message)));
              }
            }
          },
        ),
      ),
    );
  }

  Widget _errorBody(
      BuildContext context, WidgetRef ref, DeviceConfig cfg, Object e) {
    final expired = e is ApiException && e.statusCode == 401;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          expired
              ? 'Session expired. Sign in again to edit facility settings.'
              : e is ApiException
                  ? e.message
                  : 'Could not load facility settings.',
          style: const TextStyle(color: KioskPalette.danger),
        ),
        const SizedBox(height: 12),
        FilledButton(
          onPressed: () => expired
              ? _reSignIn(context, ref, cfg)
              : ref.invalidate(tenantSettingsProvider(cfg.branchId)),
          child: Text(expired ? 'Sign in' : 'Retry'),
        ),
      ],
    );
  }
}

class _AdvancedSection extends ConsumerWidget {
  const _AdvancedSection({required this.cfg});
  final DeviceConfig cfg;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final link = ref.watch(serverLinkProvider);
    return _Section(
      title: 'Advanced',
      icon: Icons.build_outlined,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _kv('Server', cfg.baseUrl),
          _kv('Connection', link == ServerLink.online ? 'online' : 'offline'),
          _kv('Branch token', cfg.branchToken.isEmpty ? 'empty' : 'set'),
          _kv('Screen token', cfg.screenToken.isEmpty ? 'empty' : 'set'),
          const SizedBox(height: 14),
          OutlinedButton.icon(
            icon: const Icon(Icons.restart_alt),
            label: const Text('Re-provision device'),
            onPressed: () async {
              final ok = await _confirm(context, 'Re-provision?',
                  'Signs out and returns to the sign-in screen. Use this to move '
                  'the device to a different account or server.');
              if (ok && context.mounted) {
                await deprovision(ref);
                if (context.mounted) {
                  Navigator.of(context).popUntil((r) => r.isFirst);
                }
              }
            },
          ),
        ],
      ),
    );
  }
}

// ── shared helpers ───────────────────────────────────────────

Widget _kv(String k, String v) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
              width: 120,
              child: Text(k, style: const TextStyle(color: KioskPalette.inkSoft))),
          Expanded(
              child:
                  Text(v, style: const TextStyle(fontWeight: FontWeight.w600))),
        ],
      ),
    );

Future<bool> _confirm(BuildContext context, String title, String body) async {
  final ok = await showDialog<bool>(
    context: context,
    builder: (c) => AlertDialog(
      title: Text(title),
      content: Text(body),
      actions: [
        TextButton(
            onPressed: () => Navigator.of(c).pop(false),
            child: const Text('Cancel')),
        FilledButton(
            onPressed: () => Navigator.of(c).pop(true),
            child: const Text('Continue')),
      ],
    ),
  );
  return ok ?? false;
}

/// Sign in again in place (session lapsed) without touching the device's
/// provisioning — the branch/screen token stays as-is.
Future<void> _reSignIn(BuildContext context, WidgetRef ref, DeviceConfig cfg) async {
  final makeApi = ref.read(appApiFactoryProvider);
  final result = await showDialog<AppLoginResult>(
    context: context,
    builder: (_) => _InlineLoginDialog(makeApi: () => makeApi(cfg.baseUrl)),
  );
  if (result != null) {
    await ref.read(authSessionProvider.notifier).signIn(result);
    if (cfg.branchId.isNotEmpty) {
      ref.invalidate(tenantSettingsProvider(cfg.branchId));
    }
  }
}

class _InlineLoginDialog extends StatefulWidget {
  const _InlineLoginDialog({required this.makeApi});
  final AppApi Function() makeApi;

  @override
  State<_InlineLoginDialog> createState() => _InlineLoginDialogState();
}

class _InlineLoginDialogState extends State<_InlineLoginDialog> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final result = await widget
          .makeApi()
          .login(email: _email.text, password: _password.text);
      if (mounted) Navigator.of(context).pop(result);
    } on ApiException catch (e) {
      setState(() {
        _error = e.message;
        _busy = false;
      });
    } catch (_) {
      setState(() {
        _error = 'Could not reach the server.';
        _busy = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Sign in'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          TextField(
            controller: _email,
            decoration: const InputDecoration(labelText: 'Email'),
            keyboardType: TextInputType.emailAddress,
            autocorrect: false,
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _password,
            decoration: const InputDecoration(labelText: 'Password'),
            obscureText: true,
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(top: 10),
              child: Text(_error!,
                  style: const TextStyle(color: KioskPalette.danger)),
            ),
        ],
      ),
      actions: [
        TextButton(
            onPressed: _busy ? null : () => Navigator.of(context).pop(),
            child: const Text('Cancel')),
        FilledButton(
          onPressed: _busy ? null : _submit,
          child: _busy
              ? const SizedBox(
                  width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
              : const Text('Sign in'),
        ),
      ],
    );
  }
}
