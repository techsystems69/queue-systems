import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../theme.dart';

/// The on-screen number pad: 1–9, then Clear · 0 · Backspace. Big keys, one
/// hairline border, a firm ripple — it is tapped by a guest standing at a wall
/// terminal, often one-handed, often with a receipt in the other.
///
/// It fills the height its parent gives it (four equal rows) rather than
/// taking a size from the caller: sizing the pad from an estimate of the text
/// around it is how the button underneath ends up clipped on a panel that is a
/// few pixels shorter than the estimate. Text and icons scale off the row.
class BusinessKeypad extends StatelessWidget {
  const BusinessKeypad({
    super.key,
    required this.clearLabel,
    required this.onDigit,
    required this.onBackspace,
    required this.onClear,
    this.gap = 12,
  });

  final String clearLabel;
  final ValueChanged<String> onDigit;
  final VoidCallback onBackspace;
  final VoidCallback onClear;
  final double gap;

  @override
  Widget build(BuildContext context) {
    Widget digit(String d) => _Key(
      onTap: () => onDigit(d),
      builder: (h) => Text(
        d,
        style: TextStyle(
          fontSize: (h * 0.44).clamp(20, 40),
          fontWeight: FontWeight.w600,
          color: KioskPalette.ink,
        ),
      ),
    );

    final rows = <List<Widget>>[
      [digit('1'), digit('2'), digit('3')],
      [digit('4'), digit('5'), digit('6')],
      [digit('7'), digit('8'), digit('9')],
      [
        _Key(
          muted: true,
          onTap: onClear,
          builder: (h) => Text(
            clearLabel,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: (h * 0.26).clamp(13, 22),
              fontWeight: FontWeight.w600,
              color: KioskPalette.inkSoft,
            ),
          ),
        ),
        digit('0'),
        _Key(
          muted: true,
          onTap: onBackspace,
          onLongPress: onClear,
          builder: (h) => Icon(
            Icons.backspace_outlined,
            size: (h * 0.36).clamp(18, 30),
            color: KioskPalette.inkSoft,
          ),
        ),
      ],
    ];

    // A numeric keypad never mirrors: 1-2-3 runs left to right on every phone
    // and ATM, Arabic included. Without this an RTL kiosk lays it out 3-2-1.
    return Directionality(
      textDirection: TextDirection.ltr,
      child: Column(
        children: [
          for (var r = 0; r < rows.length; r++) ...[
            if (r > 0) SizedBox(height: gap),
            Expanded(
              child: Row(
                children: [
                  for (var c = 0; c < rows[r].length; c++) ...[
                    if (c > 0) SizedBox(width: gap),
                    Expanded(child: rows[r][c]),
                  ],
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _Key extends StatelessWidget {
  const _Key({
    required this.onTap,
    required this.builder,
    this.onLongPress,
    this.muted = false,
  });

  final VoidCallback onTap;
  final VoidCallback? onLongPress;

  /// Builds the key's face from the row height it was given.
  final Widget Function(double height) builder;
  final bool muted;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: muted ? KioskPalette.surfaceMuted : KioskPalette.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(KioskPalette.radiusSm + 2),
        side: const BorderSide(color: KioskPalette.border, width: 1.2),
      ),
      child: InkWell(
        customBorder: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(KioskPalette.radiusSm + 2),
        ),
        onTap: () {
          HapticFeedback.selectionClick();
          onTap();
        },
        onLongPress: onLongPress,
        child: LayoutBuilder(
          builder: (_, c) => Center(child: builder(c.maxHeight)),
        ),
      ),
    );
  }
}
