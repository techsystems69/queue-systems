import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:school_kiosk/src/models/board_packet.dart';
import 'package:school_kiosk/src/ui/display/widgets/board_counter_table.dart';
import 'package:school_kiosk/src/ui/display/widgets/board_ticker.dart';
import 'package:school_kiosk/src/ui/display/widgets/board_waiting_strip.dart';
import 'package:school_kiosk/src/ui/display/widgets/now_calling_overlay.dart';
import 'package:school_kiosk/src/ui/theme.dart';

BoardCounter counter(int i, {bool called = false}) => BoardCounter(
      id: 'c$i',
      nameEn: 'Counter $i',
      nameAr: 'المنضدة $i',
      displayOrder: i,
      isOpen: true,
      tokenId: called ? 't$i' : null,
      tokenCode: called ? 'A10$i' : null,
      calledAt: called ? '2026-01-01T00:00:00Z' : null,
      recallCount: 0,
      isPriority: i.isEven,
      departmentEn: 'Admissions',
      departmentAr: 'القبول',
      departmentColor: '#2563EB',
    );

BoardDepartment department(int i, {int waiting = 0}) => BoardDepartment(
      id: 'd$i',
      nameEn: 'Department $i',
      nameAr: 'القسم $i',
      color: '#2563EB',
      displayOrder: i,
      waiting: waiting,
    );

/// Mirrors the production MediaQuery for the board: board_screen.dart wraps
/// itself in `MediaQuery.withNoTextScaling`, so `n * boardScaleForSize(...)` is
/// the only multiplier in play. A host that re-applied a text scaler here would
/// be testing a screen the app never renders.
Widget host(Widget child) => MaterialApp(
      theme: buildKioskTheme(),
      builder: (context, inner) =>
          MediaQuery.withNoTextScaling(child: inner!),
      home: Scaffold(body: child),
    );

/// Wraps in a Stack — NowCallingOverlay is a `Positioned.fill`, valid only
/// directly inside a Stack ancestor, matching how board_screen.dart actually
/// uses it.
Widget overlayHost(Widget overlay) => host(Stack(children: [overlay]));

void setViewport(WidgetTester tester, Size size) {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
}

void main() {
  // A TV board renders bilingual EN/AR labels on every row simultaneously
  // (unlike the kiosk's language *toggle*) — this is what would first
  // overflow if a label got too wide for its cell.
  for (final size in const [Size(1920, 1080), Size(1280, 720), Size(3840, 2160)]) {
    // Two open counters is the case the rows now stretch to fill; six is the
    // case they have to stop stretching and start scrolling.
    for (final count in const [2, 6]) {
      testWidgets('counter table lays out $count counters at $size', (tester) async {
        setViewport(tester, size);
        await tester.pumpWidget(host(
          BoardCounterTable(
            counters: [for (var i = 0; i < count; i++) counter(i, called: i.isEven)],
            scale: boardScaleForSize(size),
          ),
        ));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
      });
    }

    testWidgets('now-calling overlay lays out at $size', (tester) async {
      setViewport(tester, size);
      await tester.pumpWidget(overlayHost(
        NowCallingOverlay(counter: counter(1, called: true), onDismiss: () {}),
      ));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    });

    // Five departments share the width; seven has to switch to the scrolling
    // list rather than squeeze the counts below legibility.
    for (final count in const [5, 7]) {
      testWidgets('waiting strip lays out $count departments at $size', (tester) async {
        setViewport(tester, size);
        await tester.pumpWidget(host(Align(
          alignment: Alignment.bottomCenter,
          child: BoardWaitingStrip(
            departments: [for (var i = 0; i < count; i++) department(i, waiting: i * 4)],
            scale: boardScaleForSize(size),
          ),
        )));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
      });
    }
  }

  testWidgets('a called row names the department its token belongs to', (tester) async {
    setViewport(tester, const Size(1920, 1080));
    await tester.pumpWidget(host(
      BoardCounterTable(counters: [counter(0, called: true)], scale: 1),
    ));
    await tester.pumpAndSettle();
    // Under the counter name, as on the web board — plain case, no Arabic line.
    expect(find.text('Admissions'), findsOneWidget);
  });

  testWidgets('an uncalled row claims no department', (tester) async {
    setViewport(tester, const Size(1920, 1080));
    await tester.pumpWidget(host(
      BoardCounterTable(counters: [counter(0)], scale: 1),
    ));
    await tester.pumpAndSettle();
    // The packet still carries department_en for an idle counter; showing it
    // would read as "Admissions is being served" when nothing was called.
    expect(find.text('Admissions'), findsNothing);
  });

  testWidgets('the waiting strip shows a count pill per department', (tester) async {
    setViewport(tester, const Size(1920, 1080));
    await tester.pumpWidget(host(Align(
      alignment: Alignment.bottomCenter,
      child: BoardWaitingStrip(
        departments: [department(0, waiting: 18), department(1, waiting: 4)],
        scale: 1,
      ),
    )));
    await tester.pumpAndSettle();
    expect(find.text('18'), findsOneWidget);
    expect(find.text('4'), findsOneWidget);
    expect(find.text('Department 0'), findsOneWidget);
  });

  testWidgets('a called counter is a solid accent card; an idle one is plain white', (tester) async {
    setViewport(tester, const Size(1920, 1080));
    await tester.pumpWidget(host(
      BoardCounterTable(counters: [counter(0, called: true), counter(1)], scale: 1),
    ));
    await tester.pumpAndSettle();

    Color? fill(String tokenOrDash) {
      final card = find.ancestor(
        of: find.text(tokenOrDash),
        matching: find.byWidgetPredicate(
          (w) => w is Container && w.decoration is BoxDecoration &&
              (w.decoration as BoxDecoration).borderRadius != null,
        ),
      );
      return ((tester.widget<Container>(card.first)).decoration as BoxDecoration).color;
    }

    expect(fill('A100'), KioskPalette.accent);
    expect(fill('—'), KioskPalette.surface);
    expect(find.text('Please proceed'), findsOneWidget);
    expect(find.text('Available'), findsOneWidget);
  });

  // No ad rail + more than six windows -> two cards per line, as on the web board.
  for (final size in const [Size(1920, 1080), Size(1280, 720), Size(3840, 2160)]) {
    for (final count in const [7, 8, 12]) {
      testWidgets('two-column grid lays out $count counters at $size', (tester) async {
        setViewport(tester, size);
        await tester.pumpWidget(host(
          BoardCounterTable(
            counters: [for (var i = 0; i < count; i++) counter(i, called: i.isEven)],
            scale: boardScaleForSize(size),
            twoColumn: true,
          ),
        ));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        expect(find.text('Counter 0'), findsOneWidget);
        expect(find.text('Counter ${count - 1}'), findsOneWidget);
      });
    }
  }

  testWidgets('ticker lays out with a long message', (tester) async {
    setViewport(tester, const Size(1920, 1080));
    await tester.pumpWidget(host(
      const BoardTicker(message: 'Welcome to Al Noor School — please have your ID ready.'),
    ));
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));
    expect(tester.takeException(), isNull);
  });

  testWidgets('an empty counter list shows the empty state, not an overflow', (tester) async {
    setViewport(tester, const Size(1920, 1080));
    await tester.pumpWidget(host(BoardCounterTable(counters: const [], scale: 1)));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(find.text('No counters are open right now'), findsOneWidget);
  });
}
