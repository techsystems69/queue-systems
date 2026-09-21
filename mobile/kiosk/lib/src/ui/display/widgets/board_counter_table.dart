import 'package:flutter/material.dart';

import '../../../models/board_packet.dart';
import '../../theme.dart';

/// The `TOKEN NO. / COUNTER / STATUS` board — one card per **open** counter,
/// not "last N called". A counter must never vanish from the board three calls
/// later just because other counters kept calling (the layout mistake
/// docs/school-queue-plan.md explicitly calls out).
///
/// Mirrors components/school/SchoolBoard.tsx: three equal columns, a called
/// counter is a solid accent card with white type, an idle one is a plain white
/// card, and the department a called token belongs to sits under the counter
/// name. Row height is derived from the space available, so two open counters
/// fill the screen with the numbers people came to read; everything inside a
/// card is then sized off that height.
class BoardCounterTable extends StatelessWidget {
  const BoardCounterTable({
    super.key,
    required this.counters,
    required this.scale,
    this.twoColumn = false,
  });

  final List<BoardCounter> counters;
  final double scale;

  /// Two cards per line. The web board switches to this when there is no ad
  /// rail and more than six windows are open — a long row of windows reads
  /// better as a grid than as a tall stack of short bars.
  final bool twoColumn;

  @override
  Widget build(BuildContext context) {
    final open = counters.where((c) => c.isOpen).toList()
      ..sort((a, b) => a.displayOrder.compareTo(b.displayOrder));

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _HeaderRow(scale: scale),
        Expanded(
          child: open.isEmpty
              ? Center(
                  child: Text(
                    'No counters are open right now',
                    style: TextStyle(
                      fontSize: 38 * scale,
                      fontWeight: FontWeight.w500,
                      color: KioskPalette.inkFaint,
                    ),
                  ),
                )
              : LayoutBuilder(builder: (context, c) {
                  final pad = 12 * scale;
                  final gap = 10 * scale;
                  final lines = twoColumn ? (open.length / 2).ceil() : open.length;
                  final avail = c.maxHeight - 2 * pad - gap * (lines - 1);
                  // Fill the space, but never below a readable row: past that
                  // point the list scrolls rather than crushing the type.
                  final rowHeight = (avail / lines).clamp(110.0 * scale, double.infinity);
                  final overflows = rowHeight * lines + gap * (lines - 1) + 2 * pad > c.maxHeight + 1;

                  Widget card(BoardCounter counter) =>
                      _CounterCard(counter: counter, scale: scale, height: rowHeight);

                  final rows = <Widget>[
                    if (twoColumn)
                      for (var i = 0; i < open.length; i += 2)
                        Row(
                          children: [
                            Expanded(child: card(open[i])),
                            SizedBox(width: gap),
                            Expanded(
                              child: i + 1 < open.length
                                  ? card(open[i + 1])
                                  : const SizedBox.shrink(),
                            ),
                          ],
                        )
                    else
                      for (final counter in open) card(counter),
                  ];

                  return ListView.separated(
                    physics: overflows
                        ? const ClampingScrollPhysics()
                        : const NeverScrollableScrollPhysics(),
                    padding: EdgeInsets.all(pad),
                    itemCount: rows.length,
                    separatorBuilder: (_, _) => SizedBox(height: gap),
                    itemBuilder: (_, i) => rows[i],
                  );
                }),
        ),
      ],
    );
  }
}

class _HeaderRow extends StatelessWidget {
  const _HeaderRow({required this.scale});
  final double scale;

  @override
  Widget build(BuildContext context) {
    // The legend for the whole board — what each column of numbers *means* —
    // so it is set large enough to read from the same distance as the rows.
    Widget cell(String en, String ar) => Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            FittedBox(
              fit: BoxFit.scaleDown,
              alignment: Alignment.centerLeft,
              child: Text(
                en,
                maxLines: 1,
                style: TextStyle(
                  fontSize: 24 * scale,
                  fontWeight: FontWeight.w600,
                  letterSpacing: 1.6,
                  height: 1.15,
                  color: KioskPalette.inkSoft,
                ),
              ),
            ),
            Directionality(
              textDirection: TextDirection.rtl,
              child: SizedBox(
                width: double.infinity,
                child: FittedBox(
                  fit: BoxFit.scaleDown,
                  alignment: Alignment.centerLeft,
                  child: Text(
                    ar,
                    maxLines: 1,
                    style: TextStyle(
                      fontSize: 18 * scale,
                      height: 1.2,
                      color: KioskPalette.inkFaint,
                    ),
                  ),
                ),
              ),
            ),
          ],
        );

    return Container(
      padding: EdgeInsets.symmetric(horizontal: 24 * scale, vertical: 8 * scale),
      decoration: const BoxDecoration(
        color: KioskPalette.surface,
        border: Border(bottom: BorderSide(color: KioskPalette.border)),
      ),
      child: Row(
        children: [
          Expanded(child: cell('TOKEN NO.', 'رقم التذكرة')),
          SizedBox(width: 16 * scale),
          Expanded(child: cell('COUNTER', 'الشباك')),
          SizedBox(width: 16 * scale),
          Expanded(child: cell('STATUS', 'الحالة')),
        ],
      ),
    );
  }
}

class _CounterCard extends StatelessWidget {
  const _CounterCard({required this.counter, required this.scale, required this.height});
  final BoardCounter counter;
  final double scale;
  final double height;

  @override
  Widget build(BuildContext context) {
    final called = counter.isCalled;
    final fg = called ? Colors.white : KioskPalette.ink;
    final soft = called ? Colors.white70 : KioskPalette.inkSoft;

    // Everything in the card is a fraction of its height, so the same code
    // reads correctly whether two counters are open or eight.
    final tokenFont = (height * 0.42).clamp(38.0 * scale, 118.0 * scale);
    final nameFont = (height * 0.14).clamp(22.0 * scale, 44.0 * scale);
    final deptFont = nameFont * 0.5;
    final statusFont = nameFont * 0.85;
    // Only for a called token. The packet can still carry department_en on an
    // idle counter, and showing it would read as "Accounts is being served"
    // when nothing was called.
    final dept = called ? (counter.departmentEn ?? '') : '';

    // Shrink-to-fit rather than ellipsize: "COUNTER NO 1" clearing its column
    // by a hair should render a few points smaller, not as "COUNTER NO…" — the
    // point of the column is to tell someone where to walk.
    Widget fit(Widget child) => FittedBox(
          fit: BoxFit.scaleDown,
          alignment: Alignment.centerLeft,
          child: child,
        );

    return Container(
      height: height,
      padding: EdgeInsets.symmetric(horizontal: 24 * scale),
      decoration: BoxDecoration(
        color: called ? KioskPalette.accent : KioskPalette.surface,
        borderRadius: BorderRadius.circular(16 * scale),
        border: Border.all(color: called ? KioskPalette.accent : KioskPalette.border),
        boxShadow: called ? KioskPalette.hairShadow : null,
      ),
      child: Row(
        children: [
          Expanded(
            child: fit(
              Text(
                called ? counter.tokenCode! : '—',
                maxLines: 1,
                style: TextStyle(
                  fontSize: tokenFont,
                  fontWeight: FontWeight.w900,
                  height: 1.0,
                  fontFeatures: const [FontFeature.tabularFigures()],
                  color: fg,
                ),
              ),
            ),
          ),
          SizedBox(width: 16 * scale),
          Expanded(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                fit(
                  Text(
                    counter.nameEn,
                    maxLines: 1,
                    style: TextStyle(
                      fontSize: nameFont,
                      fontWeight: FontWeight.w600,
                      height: 1.15,
                      color: fg,
                    ),
                  ),
                ),
                if (dept.isNotEmpty)
                  fit(
                    Text(
                      dept,
                      maxLines: 1,
                      style: TextStyle(fontSize: deptFont, height: 1.2, color: soft),
                    ),
                  ),
              ],
            ),
          ),
          SizedBox(width: 16 * scale),
          Expanded(
            child: fit(
              Text(
                called ? 'Please proceed' : 'Available',
                maxLines: 1,
                style: TextStyle(
                  fontSize: statusFont,
                  fontWeight: FontWeight.w600,
                  color: fg,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
