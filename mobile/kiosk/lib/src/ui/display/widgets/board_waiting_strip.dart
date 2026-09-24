import 'package:flutter/material.dart';

import '../../../models/board_packet.dart';
import '../../dept_icon.dart';
import '../../theme.dart';

/// "How many are still ahead of me" — the number a waiting parent checks
/// repeatedly. One pill per department, wrapping onto further lines rather
/// than scrolling: a wall display has nobody to scroll it. Mirrors the bar at
/// the foot of components/school/SchoolBoard.tsx.
class BoardWaitingStrip extends StatelessWidget {
  const BoardWaitingStrip({super.key, required this.departments, required this.scale});

  final List<BoardDepartment> departments;
  final double scale;

  @override
  Widget build(BuildContext context) {
    final sorted = [...departments]..sort((a, b) => a.displayOrder.compareTo(b.displayOrder));
    if (sorted.isEmpty) return const SizedBox.shrink();

    return Container(
      width: double.infinity,
      padding: EdgeInsets.symmetric(horizontal: 24 * scale, vertical: 8 * scale),
      decoration: const BoxDecoration(
        color: KioskPalette.surface,
        border: Border(top: BorderSide(color: KioskPalette.border)),
      ),
      child: Wrap(
        spacing: 8 * scale,
        runSpacing: 8 * scale,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [for (final d in sorted) _Pill(department: d, scale: scale)],
      ),
    );
  }
}

class _Pill extends StatelessWidget {
  const _Pill({required this.department, required this.scale});
  final BoardDepartment department;
  final double scale;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.symmetric(horizontal: 14 * scale, vertical: 5 * scale),
      decoration: BoxDecoration(
        color: KioskPalette.bg,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: KioskPalette.border),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 10 * scale,
            height: 10 * scale,
            decoration: BoxDecoration(
              color: departmentColor(department.color),
              shape: BoxShape.circle,
            ),
          ),
          SizedBox(width: 8 * scale),
          Text(
            department.nameEn,
            style: TextStyle(fontSize: 20 * scale, color: KioskPalette.inkSoft),
          ),
          SizedBox(width: 8 * scale),
          Text(
            '${department.waiting}',
            style: TextStyle(
              fontSize: 22 * scale,
              fontWeight: FontWeight.w800,
              fontFeatures: const [FontFeature.tabularFigures()],
              color: KioskPalette.ink,
            ),
          ),
        ],
      ),
    );
  }
}
