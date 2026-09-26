import 'package:flutter/material.dart';

import '../../api/api_exception.dart';
import '../../api/app_api.dart';
import '../../config/device_vertical.dart';
import '../../models/app_service.dart';
import '../theme.dart';
import 'service_icons.dart';

// Tints per kind. Display is a cool blue so a row of cards reads as "different
// things" at a glance; the palette itself has no blue.
const _displayInk = Color(0xFF2F5BEA);
const _displaySoft = Color(0xFFE8EEFB);

/// "What should this screen do?" — the one real decision in setup.
///
/// The list is the server's service catalog for the signed-in account (see
/// `AppService`), so a service a customer gains later just appears here. Tapping
/// a card is the whole interaction: it chooses and moves on, no separate Next.
/// Cards are focusable and show a clear ring, so the same screen works with a
/// D-pad on a TV.
class ServicePickerStep extends StatefulWidget {
  const ServicePickerStep({
    super.key,
    required this.customerName,
    required this.vertical,
    required this.branches,
    required this.services,
    required this.currentServiceId,
    required this.onSelect,
    required this.onCreateDisplay,
  });

  final String customerName;
  final DeviceVertical vertical;
  final List<AppBranch> branches;
  final List<AppService> services;

  /// The service this device already runs (change mode), marked "Current".
  final String currentServiceId;
  final ValueChanged<AppService> onSelect;

  /// Creates a TV screen on the branch; throws [ApiException] with a
  /// guest-readable message (plan limit, …) on failure.
  final Future<AppService> Function(AppBranch branch, String name) onCreateDisplay;

  @override
  State<ServicePickerStep> createState() => _ServicePickerStepState();
}

class _ServicePickerStepState extends State<ServicePickerStep> {
  int _branchIndex = 0;

  AppBranch? get _branch =>
      widget.branches.isEmpty ? null : widget.branches[_branchIndex.clamp(0, widget.branches.length - 1)];

  @override
  Widget build(BuildContext context) {
    final branch = _branch;
    final services = branch == null
        ? const <AppService>[]
        : widget.services.where((s) => s.branchId == branch.id).toList();
    final customer =
        services.where((s) => s.group == AppServiceGroup.customer).toList();
    final staff =
        services.where((s) => s.group == AppServiceGroup.staff).toList();

    return ListView(
      padding: const EdgeInsets.only(bottom: 24),
      children: [
        const SizedBox(height: 22),
        Text('What should this screen do?',
            style: Theme.of(context).textTheme.headlineMedium),
        const SizedBox(height: 6),
        Text(
          [widget.vertical.label, if (widget.customerName.isNotEmpty) widget.customerName]
              .join(' · '),
          style: const TextStyle(color: KioskPalette.inkSoft, fontSize: 16),
        ),
        if (widget.branches.length > 1) ...[
          const SizedBox(height: 18),
          Wrap(
            spacing: 10,
            runSpacing: 10,
            children: [
              for (var i = 0; i < widget.branches.length; i++)
                ChoiceChip(
                  label: Text(widget.branches[i].name),
                  selected: i == _branchIndex,
                  onSelected: (_) => setState(() => _branchIndex = i),
                  labelStyle: TextStyle(
                    fontWeight: FontWeight.w600,
                    color: i == _branchIndex ? Colors.white : KioskPalette.ink,
                  ),
                  selectedColor: KioskPalette.primary,
                  backgroundColor: KioskPalette.surface,
                  checkmarkColor: Colors.white,
                  side: BorderSide(
                      color: i == _branchIndex
                          ? KioskPalette.primary
                          : KioskPalette.border),
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 10),
                ),
            ],
          ),
        ],
        const SizedBox(height: 22),
        if (branch == null)
          const _EmptyNote(
            icon: Icons.storefront_outlined,
            text: 'This account has no branch yet. Add one on the dashboard, '
                'then sign in again.',
          )
        else if (services.isEmpty && widget.services.isEmpty)
          _EmptyNote(
            icon: Icons.cloud_off_outlined,
            text: 'This server has no ${widget.vertical.label.toLowerCase()} '
                'services for the app yet. Update the server, then sign in again.',
          )
        else ...[
          _Section(
            title: 'Customer-facing',
            children: [
              for (final s in customer)
                _ServiceCard(
                  service: s,
                  isCurrent: s.id == widget.currentServiceId,
                  onTap: () => widget.onSelect(s),
                ),
              _AddDisplayCard(onTap: () => _addDisplay(branch)),
            ],
          ),
          if (staff.isNotEmpty) ...[
            const SizedBox(height: 26),
            _Section(
              title: 'Staff screens',
              children: [
                for (final s in staff)
                  _ServiceCard(
                    service: s,
                    isCurrent: s.id == widget.currentServiceId,
                    onTap: () => widget.onSelect(s),
                  ),
              ],
            ),
          ],
        ],
      ],
    );
  }

  Future<void> _addDisplay(AppBranch branch) async {
    final existing = widget.services
        .where((s) => s.branchId == branch.id && s.kind == AppServiceKind.display)
        .length;
    final created = await showDialog<AppService>(
      context: context,
      builder: (_) => _NewDisplayDialog(
        initialName: existing == 0 ? 'Lobby display' : 'Display ${existing + 1}',
        branchName: branch.name,
        create: (name) => widget.onCreateDisplay(branch, name),
      ),
    );
    if (created != null && mounted) widget.onSelect(created);
  }
}

class _Section extends StatelessWidget {
  const _Section({required this.title, required this.children});
  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, box) {
        const gap = 16.0;
        final cols = box.maxWidth >= 1000 ? 3 : (box.maxWidth >= 620 ? 2 : 1);

        // Rows of `cols` equal-width, equal-height cells. A Wrap would size each
        // card to its own content, so one description wrapping to a second line
        // makes its neighbour look short.
        final rows = <Widget>[];
        for (var i = 0; i < children.length; i += cols) {
          final slice = children.skip(i).take(cols).toList();
          rows.add(
            IntrinsicHeight(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  for (var c = 0; c < cols; c++) ...[
                    if (c > 0) const SizedBox(width: gap),
                    Expanded(
                      child: c < slice.length ? slice[c] : const SizedBox.shrink(),
                    ),
                  ],
                ],
              ),
            ),
          );
        }

        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              title.toUpperCase(),
              style: const TextStyle(
                fontSize: 12.5,
                fontWeight: FontWeight.w700,
                letterSpacing: 1.4,
                color: KioskPalette.inkFaint,
              ),
            ),
            const SizedBox(height: 12),
            for (var r = 0; r < rows.length; r++) ...[
              if (r > 0) const SizedBox(height: gap),
              rows[r],
            ],
          ],
        );
      },
    );
  }
}

class _ServiceCard extends StatefulWidget {
  const _ServiceCard({
    required this.service,
    required this.isCurrent,
    required this.onTap,
  });
  final AppService service;
  final bool isCurrent;
  final VoidCallback onTap;

  @override
  State<_ServiceCard> createState() => _ServiceCardState();
}

class _ServiceCardState extends State<_ServiceCard> {
  bool _focused = false;

  ({Color ink, Color soft, String tag}) get _tone => switch (widget.service.kind) {
        AppServiceKind.kiosk => (
            ink: KioskPalette.primary,
            soft: KioskPalette.primarySoft,
            tag: 'Kiosk',
          ),
        AppServiceKind.display => (
            ink: _displayInk,
            soft: _displaySoft,
            tag: 'Display',
          ),
        AppServiceKind.web => (
            ink: KioskPalette.priority,
            soft: KioskPalette.prioritySoft,
            tag: 'Staff',
          ),
      };

  @override
  Widget build(BuildContext context) {
    final tone = _tone;
    return AnimatedContainer(
      duration: const Duration(milliseconds: 120),
      decoration: BoxDecoration(
        color: KioskPalette.surface,
        borderRadius: BorderRadius.circular(KioskPalette.radius),
        border: Border.all(
          color: _focused || widget.isCurrent ? tone.ink : KioskPalette.border,
          width: _focused ? 2.4 : 1.4,
        ),
        boxShadow: _focused ? KioskPalette.cardShadow : KioskPalette.hairShadow,
      ),
      child: Material(
        type: MaterialType.transparency,
        child: InkWell(
          borderRadius: BorderRadius.circular(KioskPalette.radius),
          onTap: widget.onTap,
          onFocusChange: (f) => setState(() => _focused = f),
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      width: 52,
                      height: 52,
                      decoration: BoxDecoration(
                        color: tone.soft,
                        borderRadius: BorderRadius.circular(16),
                      ),
                      child: Icon(serviceIcon(widget.service.iconKey),
                          color: tone.ink, size: 28),
                    ),
                    const Spacer(),
                    if (widget.isCurrent)
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 10, vertical: 4),
                        decoration: BoxDecoration(
                          color: tone.soft,
                          borderRadius:
                              BorderRadius.circular(KioskPalette.radiusPill),
                        ),
                        child: Text('Current',
                            style: TextStyle(
                                color: tone.ink,
                                fontWeight: FontWeight.w700,
                                fontSize: 12.5)),
                      ),
                  ],
                ),
                const SizedBox(height: 16),
                Text(
                  widget.service.title,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                      fontSize: 19,
                      fontWeight: FontWeight.w700,
                      color: KioskPalette.ink),
                ),
                const SizedBox(height: 6),
                Text(
                  widget.service.description,
                  maxLines: 3,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                      fontSize: 14.5, height: 1.35, color: KioskPalette.inkSoft),
                ),
                const SizedBox(height: 14),
                const Spacer(),
                Row(
                  children: [
                    Text(tone.tag.toUpperCase(),
                        style: const TextStyle(
                            fontSize: 11.5,
                            fontWeight: FontWeight.w700,
                            letterSpacing: 1.2,
                            color: KioskPalette.inkFaint)),
                    const Spacer(),
                    Icon(Icons.arrow_forward_rounded, color: tone.ink, size: 22),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _AddDisplayCard extends StatefulWidget {
  const _AddDisplayCard({required this.onTap});
  final VoidCallback onTap;

  @override
  State<_AddDisplayCard> createState() => _AddDisplayCardState();
}

class _AddDisplayCardState extends State<_AddDisplayCard> {
  bool _focused = false;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(KioskPalette.radius),
        border: Border.all(
          color: _focused ? _displayInk : KioskPalette.borderStrong,
          width: _focused ? 2.4 : 1.4,
        ),
      ),
      child: Material(
        type: MaterialType.transparency,
        child: InkWell(
          borderRadius: BorderRadius.circular(KioskPalette.radius),
          onTap: widget.onTap,
          onFocusChange: (f) => setState(() => _focused = f),
          child: const Padding(
            padding: EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(Icons.add_circle_outline_rounded,
                    color: _displayInk, size: 34),
                SizedBox(height: 16),
                Text('New announcement display',
                    style: TextStyle(
                        fontSize: 19,
                        fontWeight: FontWeight.w700,
                        color: KioskPalette.ink)),
                SizedBox(height: 6),
                Text(
                  'Use this device as a new waiting-area board. No dashboard '
                  'visit needed.',
                  style: TextStyle(
                      fontSize: 14.5, height: 1.35, color: KioskPalette.inkSoft),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _NewDisplayDialog extends StatefulWidget {
  const _NewDisplayDialog({
    required this.initialName,
    required this.branchName,
    required this.create,
  });
  final String initialName;
  final String branchName;
  final Future<AppService> Function(String name) create;

  @override
  State<_NewDisplayDialog> createState() => _NewDisplayDialogState();
}

class _NewDisplayDialogState extends State<_NewDisplayDialog> {
  late final _name = TextEditingController(text: widget.initialName);
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_name.text.trim().isEmpty) {
      setState(() => _error = 'Give the screen a name.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final service = await widget.create(_name.text.trim());
      if (mounted) Navigator.of(context).pop(service);
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

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('New announcement display'),
      content: SizedBox(
        width: 380,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Creates a TV screen for ${widget.branchName} and sets this '
                'device up as it.',
                style: const TextStyle(color: KioskPalette.inkSoft)),
            const SizedBox(height: 16),
            TextField(
              controller: _name,
              autofocus: true,
              enabled: !_busy,
              decoration: const InputDecoration(labelText: 'Screen name'),
              textInputAction: TextInputAction.done,
              onSubmitted: (_) => _busy ? null : _submit(),
            ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(top: 12),
                child: Text(_error!,
                    style: const TextStyle(color: KioskPalette.danger)),
              ),
          ],
        ),
      ),
      actions: [
        TextButton(
            onPressed: _busy ? null : () => Navigator.of(context).pop(),
            child: const Text('Cancel')),
        FilledButton(
          onPressed: _busy ? null : _submit,
          child: _busy
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(
                      strokeWidth: 2.2, color: Colors.white))
              : const Text('Create'),
        ),
      ],
    );
  }
}

class _EmptyNote extends StatelessWidget {
  const _EmptyNote({required this.icon, required this.text});
  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(22),
      decoration: BoxDecoration(
        color: KioskPalette.surface,
        borderRadius: BorderRadius.circular(KioskPalette.radius),
        border: Border.all(color: KioskPalette.border),
      ),
      child: Row(
        children: [
          Icon(icon, size: 30, color: KioskPalette.inkFaint),
          const SizedBox(width: 16),
          Expanded(
            child: Text(text,
                style: const TextStyle(
                    fontSize: 16, height: 1.4, color: KioskPalette.inkSoft)),
          ),
        ],
      ),
    );
  }
}
