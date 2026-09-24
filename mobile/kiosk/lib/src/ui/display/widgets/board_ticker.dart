import 'package:flutter/material.dart';

import '../../theme.dart';

/// Bottom marquee — scrolls [message] right-to-left continuously. Styled like
/// the web board's footer (components/school/SchoolBoard.tsx): a light bar with
/// an accent stripe on the left. Simple
/// linear-scroll implementation (an `AnimationController` driving a
/// `Transform.translate`) rather than a package: it's one behaviour, and the
/// RK3566-class hardware this runs on has no GPU headroom to spare on a
/// fancier text-scrolling widget.
class BoardTicker extends StatefulWidget {
  const BoardTicker({super.key, required this.message, this.scale = 1});
  final String message;
  final double scale;

  @override
  State<BoardTicker> createState() => _BoardTickerState();
}

class _BoardTickerState extends State<BoardTicker> with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(vsync: this, duration: const Duration(seconds: 38))
      ..repeat();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (widget.message.trim().isEmpty) return const SizedBox.shrink();
    // Sized off the board scale like everything else on this screen — a fixed
    // 18px strip is a grey smudge on a wall-mounted panel.
    final fontSize = 30 * widget.scale;
    final style = TextStyle(
      color: KioskPalette.inkSoft,
      fontSize: fontSize,
      fontWeight: FontWeight.w500,
    );

    return Container(
      height: 64 * widget.scale,
      decoration: const BoxDecoration(
        color: KioskPalette.surface,
        border: Border(top: BorderSide(color: KioskPalette.border)),
      ),
      child: Row(
        children: [
          Container(width: 6 * widget.scale, color: KioskPalette.accent),
          Expanded(child: _marquee(style)),
        ],
      ),
    );
  }

  Widget _marquee(TextStyle style) {
    return SizedBox(
      child: ClipRect(
        child: LayoutBuilder(builder: (context, constraints) {
          // Measured once per layout, not once per frame: the old build did
          // this inside the AnimatedBuilder, laying out a TextPainter 60×/s
          // on hardware that has nothing to spare.
          final textPainter = TextPainter(
            text: TextSpan(text: widget.message, style: style),
            textDirection: TextDirection.ltr,
          )..layout();
          final totalWidth = constraints.maxWidth + textPainter.width;

          return AnimatedBuilder(
            animation: _controller,
            builder: (context, child) {
              final dx = constraints.maxWidth - _controller.value * totalWidth;
              return Stack(
                children: [
                  Positioned(
                    left: dx,
                    top: 0,
                    bottom: 0,
                    child: Center(child: child),
                  ),
                ],
              );
            },
            child: Text(widget.message, style: style),
          );
        }),
      ),
    );
  }
}
