import 'package:flutter/material.dart';

import '../theme.dart';

/// Brand colours for the sign-in surfaces. Shared with the web's sign-in /
/// activation pages (`--color-brand-*` in app/globals.css) so the two read as
/// one product.
class _Brand {
  _Brand._();

  static const panel = Color(0xFF1A4537);
  static const action = Color(0xFF1F6650);
  static const actionPressed = Color(0xFF185340);
  static const mint = Color(0xFFB7E0CF);
  static const mintSoft = Color(0xFFD5EEE3);
  static const canvas = Color(0xFFFCFCFA);
  static const field = Color(0xFFF6F6F4);
  static const fieldBorder = Color(0xFFE4E4DF);
  static const ink = Color(0xFF12141A);
  static const icon = Color(0xFF3B3F46);
}

/// The app's front door: sign in with a QueueFlow account. There is no
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
    return ColoredBox(
      color: _Brand.canvas,
      child: LayoutBuilder(
        builder: (context, box) {
          final wide = box.maxWidth >= 860;
          // With the on-screen keyboard up a landscape terminal has ~400dp left:
          // drop the brand panel so the form gets the whole height.
          final keyboardUp = MediaQuery.viewInsetsOf(context).bottom > 0;
          final showBrand = wide && !keyboardUp;

          return Row(
            children: [
              if (showBrand) const Expanded(flex: 42, child: _BrandPanel()),
              Expanded(
                flex: 58,
                child: Center(
                  child: SingleChildScrollView(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 32, vertical: 24),
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 440),
                      child: _form(context, compactLogo: !showBrand),
                    ),
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }

  InputDecoration _decoration({
    required String hint,
    required IconData icon,
    Widget? suffix,
  }) {
    OutlineInputBorder border(Color color, [double width = 1]) =>
        OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: BorderSide(color: color, width: width),
        );
    return InputDecoration(
      hintText: hint,
      hintStyle: const TextStyle(color: KioskPalette.inkSoft, fontSize: 16),
      prefixIcon: Icon(icon, color: _Brand.icon, size: 24),
      suffixIcon: suffix,
      filled: true,
      fillColor: _Brand.field,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 20),
      border: border(_Brand.fieldBorder),
      enabledBorder: border(_Brand.fieldBorder),
      disabledBorder: border(_Brand.fieldBorder),
      focusedBorder: border(_Brand.action, 1.6),
    );
  }

  Widget _form(BuildContext context, {required bool compactLogo}) {
    final busy = widget.busy;
    return AutofillGroup(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (compactLogo) ...[
            const Align(
              alignment: Alignment.centerLeft,
              child: _BrandLogo(dark: true),
            ),
            const SizedBox(height: 32),
          ],
          const Text(
            'Sign in to your workspace',
            style: TextStyle(
              color: _Brand.ink,
              fontSize: 34,
              height: 1.15,
              fontWeight: FontWeight.w700,
              letterSpacing: -0.8,
            ),
          ),
          const SizedBox(height: 8),
          const Text(
            'Use your QueueFlow account to access this device.',
            style: TextStyle(
                color: KioskPalette.inkSoft, fontSize: 16, height: 1.35),
          ),
          const SizedBox(height: 32),
          TextField(
            controller: widget.emailController,
            enabled: !busy,
            decoration:
                _decoration(hint: 'Email', icon: Icons.mail_outline_rounded),
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
            decoration: _decoration(
              hint: 'Password',
              icon: Icons.lock_outline_rounded,
              // Typing on a TV remote or a kiosk keyboard is where passwords
              // go wrong; let the installer see what they typed.
              suffix: IconButton(
                tooltip: _obscure ? 'Show password' : 'Hide password',
                icon: Icon(
                  _obscure
                      ? Icons.visibility_outlined
                      : Icons.visibility_off_outlined,
                  color: _Brand.icon,
                ),
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
                borderRadius: BorderRadius.circular(14),
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
          const SizedBox(height: 22),
          FilledButton(
            onPressed: busy ? null : widget.onSubmit,
            style: FilledButton.styleFrom(
              backgroundColor: _Brand.action,
              disabledBackgroundColor: _Brand.action.withValues(alpha: 0.7),
              minimumSize: const Size(0, 60),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(16),
              ),
            ).copyWith(
              overlayColor: WidgetStatePropertyAll(
                _Brand.actionPressed.withValues(alpha: 0.35),
              ),
            ),
            child: busy
                ? const SizedBox(
                    width: 22,
                    height: 22,
                    child: CircularProgressIndicator(
                        strokeWidth: 2.4, color: Colors.white),
                  )
                : const Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text('Sign in'),
                      SizedBox(width: 10),
                      Icon(Icons.arrow_forward_rounded, size: 22),
                    ],
                  ),
          ),
          if (widget.allowServerEdit) ...[
            const SizedBox(height: 24),
            const Divider(color: _Brand.fieldBorder),
            const SizedBox(height: 14),
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
        decoration: _decoration(hint: 'Server URL', icon: Icons.dns_outlined),
        keyboardType: TextInputType.url,
        autocorrect: false,
      );
    }
    return Row(
      children: [
        const Icon(Icons.dns_outlined, size: 18, color: KioskPalette.inkFaint),
        const SizedBox(width: 10),
        Expanded(
          child: ValueListenableBuilder<TextEditingValue>(
            valueListenable: widget.baseUrlController,
            builder: (_, v, _) => Text(
              Uri.tryParse(v.text.trim())?.host.isNotEmpty == true
                  ? Uri.parse(v.text.trim()).host
                  : v.text.trim(),
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(color: KioskPalette.inkSoft, fontSize: 14),
            ),
          ),
        ),
        TextButton(
          onPressed: () => setState(() => _editServer = true),
          style: TextButton.styleFrom(
            foregroundColor: _Brand.action,
            textStyle:
                const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
          ),
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
      color: _Brand.panel,
      padding: const EdgeInsets.symmetric(horizontal: 56, vertical: 48),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const _BrandLogo(),
          const Spacer(),
          const Text(
            'Every queue,',
            style: TextStyle(
              color: Colors.white,
              fontSize: 50,
              fontWeight: FontWeight.w700,
              letterSpacing: -1.2,
              height: 1.08,
            ),
          ),
          const Text(
            'under control.',
            style: TextStyle(
              color: _Brand.mint,
              fontSize: 50,
              fontWeight: FontWeight.w700,
              letterSpacing: -1.2,
              height: 1.08,
            ),
          ),
          const SizedBox(height: 20),
          Text(
            'Manage tickets, counters and displays from one place.',
            style: TextStyle(
              color: Colors.white.withValues(alpha: 0.66),
              fontSize: 18,
              height: 1.45,
            ),
          ),
          const Spacer(),
          Text(
            'Kiosks  ·  Displays  ·  Counters',
            style: TextStyle(
              color: Colors.white.withValues(alpha: 0.6),
              fontSize: 14,
            ),
          ),
        ],
      ),
    );
  }
}

/// Ticket glyph + "QueueFlow" wordmark. [dark] is the compact variant shown
/// above the form when the brand panel is hidden.
class _BrandLogo extends StatelessWidget {
  const _BrandLogo({this.dark = false});
  final bool dark;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        CustomPaint(
          size: const Size(36, 28),
          painter: _TicketPainter(
            body: dark ? _Brand.panel : Colors.white,
            dots: dark ? _Brand.canvas : _Brand.panel,
          ),
        ),
        const SizedBox(width: 12),
        Text.rich(
          TextSpan(
            text: 'Queue',
            style: TextStyle(
              color: dark ? _Brand.panel : Colors.white,
              fontSize: 26,
              fontWeight: FontWeight.w700,
              letterSpacing: -0.5,
            ),
            children: [
              TextSpan(
                text: 'Flow',
                style: TextStyle(color: dark ? _Brand.action : _Brand.mintSoft),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

/// Rounded ticket with a notch on each side and three perforation dots — the
/// same 36×28 path as the web's `TicketMark`.
class _TicketPainter extends CustomPainter {
  const _TicketPainter({required this.body, required this.dots});
  final Color body;
  final Color dots;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.scale(size.width / 36, size.height / 28);
    const r = Radius.circular(4);
    const notch = Radius.circular(3.5);
    final path = Path()
      ..moveTo(4, 0)
      ..lineTo(32, 0)
      ..arcToPoint(const Offset(36, 4), radius: r)
      ..lineTo(36, 10.5)
      ..arcToPoint(const Offset(36, 17.5), radius: notch, clockwise: false)
      ..lineTo(36, 24)
      ..arcToPoint(const Offset(32, 28), radius: r)
      ..lineTo(4, 28)
      ..arcToPoint(const Offset(0, 24), radius: r)
      ..lineTo(0, 17.5)
      ..arcToPoint(const Offset(0, 10.5), radius: notch, clockwise: false)
      ..lineTo(0, 4)
      ..arcToPoint(const Offset(4, 0), radius: r)
      ..close();
    canvas.drawPath(path, Paint()..color = body);
    final dot = Paint()..color = dots;
    for (final y in const [7.0, 14.0, 21.0]) {
      canvas.drawCircle(Offset(18, y), 1.7, dot);
    }
  }

  @override
  bool shouldRepaint(_TicketPainter old) =>
      old.body != body || old.dots != dots;
}
