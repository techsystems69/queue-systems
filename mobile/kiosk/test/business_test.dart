import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:school_kiosk/src/announce/business_announcer.dart';
import 'package:school_kiosk/src/api/api_exception.dart';
import 'package:school_kiosk/src/config/device_config.dart';
import 'package:school_kiosk/src/i18n/business_copy.dart';
import 'package:school_kiosk/src/models/business/business_board_packet.dart';
import 'package:school_kiosk/src/models/business/business_kiosk_bootstrap.dart';
import 'package:school_kiosk/src/models/business/business_ticket.dart';
import 'package:school_kiosk/src/state/business_providers.dart';
import 'package:school_kiosk/src/state/providers.dart';
import 'package:school_kiosk/src/ui/business/business_board_screen.dart';
import 'package:school_kiosk/src/ui/business/business_kiosk_screen.dart';
import 'package:school_kiosk/src/ui/theme.dart';

// ── fixtures ────────────────────────────────────────────────────

BusinessKioskBootstrap bootstrap({
  bool allowSelfJoin = true,
  List<String> languages = const ['en'],
}) =>
    BusinessKioskBootstrap.fromJson({
      'branchId': 'b1',
      'branchName': 'Main Kitchen',
      'businessName': 'Spice Garden',
      'logoUrl': '',
      'queueLabel': 'Queue Number',
      'allowSelfJoin': allowSelfJoin,
      'maxCapacity': 100,
      'currentServingNumber': 12,
      'waitingCount': 5,
      'isPaused': false,
      'languages': languages,
    });

BusinessBoardPacket board({
  int serving = 12,
  int callCount = 1,
  bool withServing = true,
  int waiting = 3,
  String lang = 'en',
}) =>
    BusinessBoardPacket.fromJson({
      'status': 'ok',
      'screenName': 'Lobby TV',
      'branchName': 'Main Kitchen',
      'businessName': 'Spice Garden',
      'logoUrl': '',
      'queueLabel': 'Queue Number',
      'tickerText': 'Free dessert with every family meal',
      'currentServingNumber': serving,
      'isPaused': false,
      'serving': withServing
          ? {
              'entryId': 'e$serving',
              'queueNumber': serving,
              'billNumber': '1042',
              'callCount': callCount,
            }
          : null,
      'next': [
        for (var i = 1; i <= waiting.clamp(0, 8); i++)
          {'queueNumber': serving + i, 'billNumber': '${1042 + i}'},
      ],
      'waitingCount': waiting,
      'ads': const [],
      'tickers': const [],
      'settings': {
        'theme': 'standard',
        'showAds': true,
        'showTicker': true,
        'showClock': true,
        'announcementLang': lang,
      },
    });

// ── fakes ───────────────────────────────────────────────────────

class _Cfg extends DeviceConfigController {
  @override
  Future<DeviceConfig> build() => DeviceConfig.load();
}

class _FixedFeed extends BusinessFeedController {
  _FixedFeed(this._feed);
  final BusinessKioskFeed _feed;
  @override
  Future<BusinessKioskFeed> build() async => _feed;
  @override
  Future<void> refreshNow() async {}
}

class _FakeController extends BusinessKioskController {
  _FakeController(super.ref, this.onIssue);
  final Future<IssuedBusinessTicket> Function(String bill) onIssue;
  @override
  Future<IssuedBusinessTicket> issue(String billNumber) => onIssue(billNumber);
}

class _FixedBoard extends BusinessBoardController {
  _FixedBoard(this._packet);
  final BusinessBoardPacket _packet;
  @override
  Future<BusinessBoardPacket> build() async => _packet;
  void emit(BusinessBoardPacket p) => state = AsyncData(p);
}

class _RecordingAnnouncer extends BusinessAnnouncer {
  final calls = <(int, String)>[];
  @override
  Future<void> announceCall({
    required int queueNumber,
    required String announcementLang,
  }) async {
    calls.add((queueNumber, announcementLang));
  }
}

/// The plugins a real device has and a test host doesn't: text-to-speech and
/// the wake lock. Absorb their channels so a screen can mount.
void _mockPlugins() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  messenger.setMockMethodCallHandler(const MethodChannel('flutter_tts'), (_) async => 1);
  messenger.setMockMessageHandler(
    'dev.flutter.pigeon.wakelock_plus_platform_interface.WakelockPlusApi.toggle',
    (_) async => const StandardMessageCodec().encodeMessage(<Object?>[]),
  );
}

void _viewport(WidgetTester tester, Size size) {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
}

/// Mirrors app.dart's kiosk MediaQuery (OS text scale pinned off, replaced by
/// the screen-size factor) so the tests render the sizes a real terminal does.
Widget _app(Widget home) => MaterialApp(
      theme: buildKioskTheme(),
      builder: (context, inner) {
        final media = MediaQuery.of(context);
        return MediaQuery(
          data: media.copyWith(
            textScaler: TextScaler.linear(kioskTextScaleForSize(media.size)),
          ),
          child: inner!,
        );
      },
      home: home,
    );

Future<ProviderContainer> _pumpKiosk(
  WidgetTester tester, {
  BusinessKioskBootstrap? boot,
  BusinessKioskFeed? feed,
  Future<IssuedBusinessTicket> Function(String)? onIssue,
  Size size = const Size(1366, 768),
}) async {
  _mockPlugins();
  SharedPreferences.setMockInitialValues({});
  _viewport(tester, size);
  final container = ProviderContainer(overrides: [
    deviceConfigProvider.overrideWith(_Cfg.new),
    businessBootstrapProvider.overrideWith((ref) async => boot ?? bootstrap()),
    businessFeedProvider.overrideWith(() => _FixedFeed(feed ??
        const BusinessKioskFeed(
          currentServingNumber: 12,
          waitingCount: 5,
          isPaused: false,
          allowSelfJoin: true,
        ))),
    businessKioskControllerProvider.overrideWith((ref) => _FakeController(
          ref,
          onIssue ??
              (bill) async => (
                    ticket: BusinessTicket(
                      id: 't1',
                      queueNumber: 18,
                      billNumber: bill,
                      customerName: '',
                      joinedAt: '2026-09-24T10:00:00Z',
                    ),
                    waitingAhead: 4,
                  ),
        )),
  ]);
  addTearDown(container.dispose);
  await tester.runAsync(() => container.read(deviceConfigProvider.future));
  await tester.pumpWidget(UncontrolledProviderScope(
    container: container,
    child: _app(const BusinessKioskScreen()),
  ));
  await tester.pumpAndSettle();
  return container;
}

/// Taps submit and shows the confirmation. Deliberately not `pumpAndSettle`:
/// the confirmation's countdown bar animates for the full linger, and settling
/// would run past it into the reset back to the entry screen.
Future<void> _submit(WidgetTester tester, String label) async {
  await tester.tap(find.widgetWithText(FilledButton, label));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 400));
}

/// Lets the confirmation's auto-reset timer fire so no timer outlives the test.
Future<void> _drain(WidgetTester tester) => tester.pump(const Duration(seconds: 10));

Future<void> _tapDigits(WidgetTester tester, String digits) async {
  for (final d in digits.split('')) {
    await tester.tap(find.text(d).last);
    await tester.pump();
  }
}

void main() {
  // ── pure logic ────────────────────────────────────────────────

  group('models', () {
    test('kiosk bootstrap falls back to safe defaults', () {
      final b = BusinessKioskBootstrap.fromJson({'branchId': 'b1'});
      expect(b.allowSelfJoin, isTrue);
      expect(b.languages, ['en']);
      expect(b.title, '');
    });

    test('the brand line prefers the business over the branch', () {
      expect(bootstrap().title, 'Spice Garden');
      expect(
        BusinessKioskBootstrap.fromJson({'branchName': 'Main', 'businessName': ''}).title,
        'Main',
      );
    });

    test('a board packet parses the serving entry, queue and settings', () {
      final p = board(serving: 7, waiting: 2, lang: 'both');
      expect(p.isOk, isTrue);
      expect(p.serving!.queueNumber, 7);
      expect(p.serving!.callKey, 'e7:1');
      expect(p.next.map((e) => e.queueNumber), [8, 9]);
      expect(p.waitingCount, 2);
      expect(p.announcementLang, 'both');
      expect(p.showClock, isTrue);
    });

    test('between calls there is no serving entry', () {
      expect(board(withServing: false).serving, isNull);
    });

    test('ads keep the school ad model so the shared rail can play them', () {
      final p = BusinessBoardPacket.fromJson({
        'status': 'ok',
        'ads': [
          {
            'id': 'a1',
            'fileUrl': 'https://x/a.mp4',
            'fileType': 'video',
            'durationSeconds': 12,
            'audioEnabled': true,
          },
        ],
      });
      expect(p.ads.single.isVideo, isTrue);
      expect(p.ads.single.durationSeconds, 12);
      expect(p.ads.single.audioEnabled, isTrue);
    });
  });

  group('announcements', () {
    test('three-digit numbers are spoken digit by digit', () {
      expect(spellNumber(7), '7');
      expect(spellNumber(42), '42');
      expect(spellNumber(105), '1, 0, 5');
    });

    test('the announcement language picks the locales spoken', () {
      expect(announceLocales('en'), ['en']);
      expect(announceLocales('ar'), ['ar']);
      expect(announceLocales('both'), ['en', 'ar']);
      expect(announceLocales('anything-else'), ['en']);
    });

    test('a board that just came up announces nothing, then each new call once', () {
      final d = BusinessAnnouncementDedupe();
      final first = board(serving: 12, callCount: 1).serving;
      expect(d.newCall(first), isNull, reason: 'first packet only primes');
      expect(d.newCall(first), isNull, reason: 'unchanged');
      expect(d.newCall(board(serving: 13, callCount: 1).serving)!.queueNumber, 13);
      expect(d.newCall(board(serving: 13, callCount: 1).serving), isNull);
    });

    test('a recall of the same guest announces again', () {
      final d = BusinessAnnouncementDedupe();
      d.newCall(board(serving: 12, callCount: 1).serving);
      expect(d.newCall(board(serving: 12, callCount: 2).serving)!.queueNumber, 12);
    });

    test('nobody in progress resets, so the same guest called later still announces',
        () {
      final d = BusinessAnnouncementDedupe();
      d.newCall(board(serving: 12, callCount: 1).serving);
      expect(d.newCall(null), isNull);
      expect(d.newCall(board(serving: 12, callCount: 1).serving)!.queueNumber, 12);
    });
  });

  group('copy', () {
    test('every supported locale defines every string the kiosk uses', () {
      for (final l in BusinessCopy.supported) {
        final c = BusinessCopy.of(l);
        for (final s in [
          c.welcome, c.prompt, c.promptHint, c.getNumber, c.issuing,
          c.yourNumber, c.bill, c.keepTicket, c.clear, c.done, c.selfJoinOff,
          c.offline, c.paused, c.printFailed, c.nowServing, c.nowCalling,
          c.proceed, c.nextUp, c.waiting, c.waitingForNext, c.noneWaiting,
          c.step1, c.step2, c.step3, c.ahead(0), c.ahead(1), c.ahead(6),
        ]) {
          expect(s.trim(), isNotEmpty, reason: l);
        }
        expect(c.ahead(6), contains('6'), reason: l);
      }
    });

    test('an unknown locale falls back to English', () {
      expect(BusinessCopy.of('fr').prompt, BusinessCopy.of('en').prompt);
    });

    test('only Arabic is right-to-left', () {
      expect(BusinessCopy.of('ar').isRtl, isTrue);
      expect(BusinessCopy.of('hi').isRtl, isFalse);
    });
  });

  // ── kiosk ─────────────────────────────────────────────────────

  group('kiosk screen', () {
    testWidgets('the keypad builds the bill number and Get my number issues it',
        (tester) async {
      String? issuedFor;
      await _pumpKiosk(tester, onIssue: (bill) async {
        issuedFor = bill;
        return (
          ticket: BusinessTicket(
            id: 't1',
            queueNumber: 18,
            billNumber: bill,
            customerName: '',
            joinedAt: '',
          ),
          waitingAhead: 4,
        );
      });

      expect(find.text('Enter your bill number'), findsOneWidget);
      expect(find.text('Welcome'), findsOneWidget);
      // Nothing to submit yet.
      expect(
        tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Get my number')).onPressed,
        isNull,
      );

      await _tapDigits(tester, '1042');
      expect(find.text('1042'), findsOneWidget);

      await _submit(tester, 'Get my number');

      expect(issuedFor, '1042');
      // The confirmation: the number, the bill, and how many are ahead.
      expect(find.text('18'), findsOneWidget);
      expect(find.text('Bill 1042'), findsOneWidget);
      expect(find.text('4 guests ahead of you'), findsOneWidget);
      // The entry field is gone — the next guest starts clean.
      expect(find.text('Enter your bill number'), findsNothing);

      // …and after the linger the kiosk is back on a clean entry screen.
      await _drain(tester);
      expect(find.text('Enter your bill number'), findsOneWidget);
      expect(find.text('1042'), findsNothing);
    });

    testWidgets('backspace and clear edit the number', (tester) async {
      await _pumpKiosk(tester);
      await _tapDigits(tester, '789');
      expect(find.text('789'), findsOneWidget);
      await tester.tap(find.byIcon(Icons.backspace_outlined));
      await tester.pump();
      expect(find.text('78'), findsOneWidget);
      await tester.tap(find.text('Clear'));
      await tester.pump();
      expect(find.text('78'), findsNothing);
      expect(find.text('—'), findsWidgets, reason: 'back to the empty placeholder');
    });

    testWidgets('a scanner or keyboard types into the same field and Enter submits',
        (tester) async {
      String? issuedFor;
      await _pumpKiosk(tester, onIssue: (bill) async {
        issuedFor = bill;
        return (
          ticket: BusinessTicket(
              id: 't', queueNumber: 3, billNumber: bill, customerName: '', joinedAt: ''),
          waitingAhead: 0,
        );
      });

      await simulateKeyDownEvent(LogicalKeyboardKey.keyA, character: 'a');
      await simulateKeyDownEvent(LogicalKeyboardKey.digit7, character: '7');
      await simulateKeyDownEvent(LogicalKeyboardKey.digit7, character: '7');
      await tester.pump();
      expect(find.text('A77'), findsOneWidget, reason: 'letters are upper-cased');

      await simulateKeyDownEvent(LogicalKeyboardKey.enter);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      expect(issuedFor, 'A77');
      expect(find.text('You are next in line'), findsOneWidget);
      await _drain(tester);
    });

    testWidgets('the number is capped so a stuck key cannot fill the field',
        (tester) async {
      await _pumpKiosk(tester);
      await _tapDigits(tester, '1' * 20);
      expect(find.text('1' * 12), findsOneWidget);
      expect(find.text('1' * 13), findsNothing);
    });

    testWidgets("the server's rejection is shown, and the guest can try again",
        (tester) async {
      var calls = 0;
      await _pumpKiosk(tester, onIssue: (bill) async {
        calls++;
        throw ApiException('The queue is full right now. Please see the counter staff.',
            statusCode: 400);
      });
      await _tapDigits(tester, '9');
      await tester.tap(find.widgetWithText(FilledButton, 'Get my number'));
      await tester.pumpAndSettle();

      expect(find.textContaining('queue is full'), findsOneWidget);
      // Still on the entry screen with the digits kept, so a retry is one tap.
      expect(find.text('Enter your bill number'), findsOneWidget);
      await tester.tap(find.widgetWithText(FilledButton, 'Get my number'));
      await tester.pumpAndSettle();
      expect(calls, 2);
    });

    testWidgets('a network failure says the connection is the problem, not the kiosk',
        (tester) async {
      await _pumpKiosk(tester, onIssue: (_) async {
        throw ApiException('Cannot reach the queue server.', isNetwork: true);
      });
      await _tapDigits(tester, '9');
      await tester.tap(find.widgetWithText(FilledButton, 'Get my number'));
      await tester.pumpAndSettle();
      expect(find.text("Can't reach the server. Retrying…"), findsOneWidget);
    });

    testWidgets('a branch with self-join off shows a notice instead of a keypad',
        (tester) async {
      await _pumpKiosk(
        tester,
        boot: bootstrap(allowSelfJoin: false),
        feed: const BusinessKioskFeed(
          currentServingNumber: 0,
          waitingCount: 0,
          isPaused: false,
          allowSelfJoin: false,
        ),
      );
      expect(find.text('Please see the counter staff to get your number.'), findsOneWidget);
      expect(find.text('Get my number'), findsNothing);
    });

    testWidgets('shows what is being served and who is waiting', (tester) async {
      await _pumpKiosk(tester);
      expect(find.text('NOW SERVING'), findsOneWidget);
      expect(find.text('12'), findsOneWidget);
      expect(find.text('5 waiting'), findsOneWidget);
    });

    testWidgets('a multi-language deployment offers a language switch',
        (tester) async {
      await _pumpKiosk(tester, boot: bootstrap(languages: const ['en', 'hi']));
      expect(find.text('Enter your bill number'), findsOneWidget);
      await tester.tap(find.text('हि'));
      await tester.pumpAndSettle();
      expect(find.text('अपना बिल नंबर दर्ज करें'), findsOneWidget);
    });

    // The deployed terminal, budget panels, a large one, and a phone both ways.
    for (final size in const [
      Size(1366, 768),
      Size(1280, 800),
      Size(1920, 1080),
      Size(1024, 600),
      Size(800, 480),
      Size(2400, 1080),
      Size(1080, 2400),
    ]) {
      for (final lang in const ['en', 'ar', 'hi', 'mr']) {
        testWidgets('entry and confirmation lay out at $size / $lang', (tester) async {
          await _pumpKiosk(
            tester,
            size: size,
            boot: bootstrap(languages: [lang]),
          );
          expect(tester.takeException(), isNull, reason: 'entry');

          // Nothing the guest must touch may be pushed off the panel: the
          // submit button is fully on screen, and every key stays finger-sized.
          final copy = BusinessCopy.of(lang);
          final button = tester.getRect(find.widgetWithText(FilledButton, copy.getNumber));
          expect(button.bottom, lessThanOrEqualTo(size.height + 0.5),
              reason: 'Get my number is on screen');
          expect(button.top, greaterThanOrEqualTo(0));
          for (final d in const ['0', '5', '9']) {
            final key = tester.getRect(find.ancestor(
                of: find.text(d).last, matching: find.byType(InkWell)));
            expect(key.height, greaterThanOrEqualTo(38), reason: 'key $d is finger-sized');
            expect(key.bottom, lessThanOrEqualTo(size.height));
          }

          await _tapDigits(tester, '1042');
          expect(tester.takeException(), isNull, reason: 'digits');
          await _submit(tester, copy.getNumber);
          expect(tester.takeException(), isNull, reason: 'confirmation');
          expect(find.text('18'), findsOneWidget, reason: 'the ticket number is shown');
          await _drain(tester);
        });
      }
    }
  });

  // ── board ─────────────────────────────────────────────────────

  group('board screen', () {
    Future<({ProviderContainer c, _RecordingAnnouncer a})> pumpBoard(
      WidgetTester tester,
      BusinessBoardPacket packet, {
      Size size = const Size(1920, 1080),
    }) async {
      _mockPlugins();
      _viewport(tester, size);
      final announcer = _RecordingAnnouncer();
      final container = ProviderContainer(overrides: [
        businessBoardProvider.overrideWith(() => _FixedBoard(packet)),
        businessAnnouncerProvider.overrideWithValue(announcer),
      ]);
      addTearDown(container.dispose);
      await tester.pumpWidget(UncontrolledProviderScope(
        container: container,
        child: MaterialApp(
          theme: buildKioskTheme(),
          home: const BusinessBoardScreen(),
        ),
      ));
      await tester.pump(const Duration(milliseconds: 50));
      await tester.pump(const Duration(milliseconds: 50));
      return (c: container, a: announcer);
    }

    testWidgets('shows the serving number, the bill, and who is next', (tester) async {
      await pumpBoard(tester, board(serving: 12, waiting: 3));
      expect(find.text('Spice Garden'), findsOneWidget);
      expect(find.text('NOW SERVING'), findsOneWidget);
      expect(find.text('12'), findsOneWidget);
      expect(find.text('Bill 1042'), findsOneWidget);
      expect(find.text('NEXT UP'), findsOneWidget);
      expect(find.text('13'), findsOneWidget);
      expect(find.text('14'), findsOneWidget);
      expect(find.text('15'), findsOneWidget);
      expect(find.text('3 waiting'), findsOneWidget);
    });

    testWidgets('between calls it says it is waiting for the next guest', (tester) async {
      await pumpBoard(tester, board(serving: 0, withServing: false, waiting: 0));
      expect(find.text('—'), findsOneWidget);
      expect(find.text('Waiting for the next guest'), findsOneWidget);
      expect(find.text('No one is waiting'), findsOneWidget);
    });

    testWidgets('the first packet is not announced; a new call is, and flashes',
        (tester) async {
      final h = await pumpBoard(tester, board(serving: 12, callCount: 1));
      expect(h.a.calls, isEmpty, reason: 'a board that just came up stays quiet');
      expect(find.text('NOW CALLING'), findsNothing);

      (h.c.read(businessBoardProvider.notifier) as _FixedBoard)
          .emit(board(serving: 13, callCount: 1, lang: 'both'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));

      expect(h.a.calls, [(13, 'both')]);
      expect(find.text('NOW CALLING'), findsOneWidget);
      expect(find.text('Please proceed to the counter'), findsOneWidget);
      // Bilingual when the screen is set to both languages.
      expect(find.text('يرجى التوجه إلى المنضدة'), findsOneWidget);

      // Dismissed on tap.
      await tester.tap(find.text('NOW CALLING'));
      await tester.pump();
      expect(find.text('NOW CALLING'), findsNothing);

      // Let the auto-dismiss timer finish so the test ends clean.
      await tester.pump(const Duration(seconds: 9));
    });

    testWidgets('an Arabic board stacks the Arabic labels', (tester) async {
      await pumpBoard(tester, board(lang: 'both'));
      expect(find.text('NOW SERVING'), findsOneWidget);
      expect(find.text('يتم الخدمة الآن'), findsOneWidget);
    });

    for (final size in const [
      Size(1920, 1080),
      Size(1366, 768),
      Size(1280, 720),
      Size(3840, 2160),
      Size(1080, 1920), // portrait TV
    ]) {
      for (final lang in const ['en', 'ar', 'both']) {
        testWidgets('lays out at $size / $lang', (tester) async {
          await pumpBoard(tester, board(serving: 105, waiting: 8, lang: lang), size: size);
          expect(tester.takeException(), isNull);
        });
      }
    }
  });
}
