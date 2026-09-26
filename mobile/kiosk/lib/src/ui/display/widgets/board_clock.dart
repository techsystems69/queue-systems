import 'dart:async';

import 'package:flutter/material.dart';

import '../../theme.dart';

/// Time to the second plus the date, right-aligned — `DisplayClock` on the web.
/// Fixed-width digits (tabular figures) keep the seconds from jiggling the layout
/// without depending on a `monospace` font family being present on the device.
class BoardClock extends StatefulWidget {
  const BoardClock({super.key, required this.scale});
  final double scale;

  @override
  State<BoardClock> createState() => _BoardClockState();
}

class _BoardClockState extends State<BoardClock> {
  DateTime _now = DateTime.now();
  Timer? _timer;

  static const _weekdays = [
    'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
  ];
  static const _months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  @override
  void initState() {
    super.initState();
    // Once a second, on the second: the seconds digit is the one people watch.
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() => _now = DateTime.now());
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    String two(int n) => n.toString().padLeft(2, '0');
    final hour = _now.hour % 12 == 0 ? 12 : _now.hour % 12;
    final time = '${two(hour)}:${two(_now.minute)}:${two(_now.second)} '
        '${_now.hour >= 12 ? 'PM' : 'AM'}';
    final date = '${_weekdays[_now.weekday - 1]}, ${_months[_now.month - 1]} ${_now.day}';

    return Column(
      crossAxisAlignment: CrossAxisAlignment.end,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          time,
          style: TextStyle(
            fontSize: 36 * widget.scale,
            fontWeight: FontWeight.w700,
            height: 1.0,
            fontFeatures: const [FontFeature.tabularFigures()],
            color: KioskPalette.ink,
          ),
        ),
        SizedBox(height: 4 * widget.scale),
        Text(
          date,
          style: TextStyle(fontSize: 17 * widget.scale, color: KioskPalette.inkSoft),
        ),
      ],
    );
  }
}
