import 'package:flutter/material.dart';

import '../theme.dart';

/// The app's front door: sign in with a queue-system account. There is no
/// pairing code and no product picker — the account's tenant decides the
/// product (hotel / school / hospital), and the next screen lists what this
/// device can become.
///
/// Full-bleed and two-pane on a landscape terminal: a brand panel that says what
/// the app is for, and the form. The wizard owns the session; this widget only
/// collects the credentials (and, tucked away, the server URL — right for every
/// customer by default, only ever edited by an installer on a private
/// deployment).
class LoginStep extends StatefulWidget {
  const LoginStep({
    super.key,
    required this.emailController,
    required this.passwordController,
    required this.baseUrlController,
    required this.busy,
    required this.error,
    required this.onSubmit,
    this.allowServerEdit = true,
  });

  final TextEditingController emailController;
  final TextEditingController passwordController;
  final TextEditingController baseUrlController;
  final bool busy;
  final String? error;
  final VoidCallback onSubmit;
  final bool allowServerEdit;

  @override
  State<LoginStep> createState() => _LoginStepState();
}

class _LoginStepState extends State<LoginStep> {
  bool _obscure = true;
  bool _editServer = false;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, box) {
        final wide = box.maxWidth >= 860;
        // With the on-screen keyboard up a landscape terminal has ~400dp left:
        // drop the brand panel so the form gets the whole height.
        final keyboardUp = MediaQuery.viewInsetsOf(context).bottom > 0;
        final showBrand = wide && !keyboardUp;

        return Row(
          children: [
            if (showBrand)
              Expanded(
                flex: 11,
                child: const _BrandPanel(),
              ),
            Expanded(
              flex: 10,
              child: Center(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 24),
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 420),
                    child: _form(context),
                  ),
                ),
              ),
            ),
          ],
        );
      },
    );
  }

  Widget _form(BuildContext context) {
    final busy = widget.busy;
    return AutofillGroup(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text('Sign in', style: Theme.of(context).textTheme.headlineMedium),
          const SizedBox(height: 6),
          const Text(
            'Use your VibeQueue account to set up this device.',
            style: TextStyle(color: KioskPalette.inkSoft, height: 1.35),
          ),
          const SizedBox(height: 24),
          TextField(
            controller: widget.emailController,
            enabled: !busy,
            decoration: const InputDecoration(
              labelText: 'Email',
              prefixIcon: Icon(Icons.mail_outline_rounded),
            ),
            keyboardType: TextInputType.emailAddress,
            autofillHints: const [AutofillHints.username, AutofillHints.email],
            autocorrect: false,
            enableSuggestions: false,
            textInputAction: TextInputAction.next,
          ),
          const SizedBox(height: 14),
          TextField(
            controller: widget.passwordController,
            enabled: !busy,
            decoration: InputDecoration(
              labelText: 'Password',
              prefixIcon: const Icon(Icons.lock_outline_rounded),
              // Typing on a TV remote or a kiosk keyboard is where passwords
              // go wrong; let the installer see what they typed.
              suffixIcon: IconButton(
                tooltip: _obscure ? 'Show password' : 'Hide password',
                icon: Icon(_obscure
                    ? Icons.visibility_outlined
                    : Icons.visibility_off_outlined),
                onPressed: () => setState(() => _obscure = !_obscure),
              ),
            ),
            obscureText: _obscure,
            autofillHints: const [AutofillHints.password],
            autocorrect: false,
            enableSuggestions: false,
            onSubmitted: (_) => busy ? null : widget.onSubmit(),
          ),
          if (widget.error != null) ...[
            const SizedBox(height: 14),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: KioskPalette.dangerSoft,
                borderRadius: BorderRadius.circular(KioskPalette.radiusSm),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Icon(Icons.error_outline_rounded,
                      size: 20, color: KioskPalette.danger),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(widget.error!,
                        style: const TextStyle(color: KioskPalette.danger)),
                  ),
                ],
              ),
            ),
          ],
          const SizedBox(height: 20),
          FilledButton(
            onPressed: busy ? null : widget.onSubmit,
            child: busy
                ? const SizedBox(
                    width: 22,
                    height: 22,
                    child: CircularProgressIndicator(
                        strokeWidth: 2.4, color: Colors.white),
                  )
                : const Text('Sign in'),
          ),
          if (widget.allowServerEdit) ...[
            const SizedBox(height: 20),
            _serverRow(),
          ],
        ],
      ),
    );
  }

  Widget _serverRow() {
    if (_editServer) {
      return TextField(
        controller: widget.baseUrlController,
        enabled: !widget.busy,
        decoration: const InputDecoration(
          labelText: 'Server URL',
          prefixIcon: Icon(Icons.dns_outlined),
        ),
        keyboardType: TextInputType.url,
        autocorrect: false,
      );
    }
    return Row(
      children: [
        const Icon(Icons.dns_outlined, size: 16, color: KioskPalette.inkFaint),
        const SizedBox(width: 8),
        Expanded(
          child: ValueListenableBuilder<TextEditingValue>(
            valueListenable: widget.baseUrlController,
            builder: (_, v, _) => Text(
              Uri.tryParse(v.text.trim())?.host.isNotEmpty == true
                  ? Uri.parse(v.text.trim()).host
                  : v.text.trim(),
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(color: KioskPalette.inkFaint, fontSize: 13),
            ),
          ),
        ),
        TextButton(
          onPressed: () => setState(() => _editServer = true),
          child: const Text('Change server'),
        ),
      ],
    );
  }
}

class _BrandPanel extends StatelessWidget {
  const _BrandPanel();

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF2F7662), Color(0xFF1B4D3F)],
        ),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 56, vertical: 48),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            width: 64,
            height: 64,
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.16),
              borderRadius: BorderRadius.circular(20),
            ),
            child: const Icon(Icons.confirmation_number_outlined,
                color: Colors.white, size: 34),
          ),
          const SizedBox(height: 28),
          const Text(
            'VibeQueue',
            style: TextStyle(
              color: Colors.white,
              fontSize: 44,
              fontWeight: FontWeight.w800,
              letterSpacing: -1,
              height: 1.05,
            ),
          ),
          const SizedBox(height: 12),
          Text(
            'One app for every queue in your business.',
            style: TextStyle(
              color: Colors.white.withValues(alpha: 0.85),
              fontSize: 19,
              height: 1.35,
            ),
          ),
          const SizedBox(height: 40),
          const _Point(Icons.touch_app_outlined, 'Ticket kiosks that print'),
          const _Point(Icons.tv_rounded, 'Boards that announce out loud'),
          const _Point(Icons.dashboard_customize_outlined,
              'Staff screens for every counter'),
        ],
      ),
    );
  }
}

class _Point extends StatelessWidget {
  const _Point(this.icon, this.text);
  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Row(
        children: [
          Icon(icon, color: Colors.white.withValues(alpha: 0.9), size: 22),
          const SizedBox(width: 14),
          Text(
            text,
            style: TextStyle(
              color: Colors.white.withValues(alpha: 0.92),
              fontSize: 16,
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }
}
