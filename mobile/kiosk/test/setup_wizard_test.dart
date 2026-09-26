import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:school_kiosk/src/api/app_api.dart';
import 'package:school_kiosk/src/config/auth_session.dart';
import 'package:school_kiosk/src/config/device_config.dart';
import 'package:school_kiosk/src/config/device_role.dart';
import 'package:school_kiosk/src/config/device_vertical.dart';
import 'package:school_kiosk/src/state/app_auth_providers.dart';
import 'package:school_kiosk/src/state/providers.dart';
import 'package:school_kiosk/src/ui/setup/setup_wizard.dart';

class _FakeAdapter implements HttpClientAdapter {
  _FakeAdapter(this.respond);
  final Future<ResponseBody> Function(RequestOptions options) respond;
  @override
  Future<ResponseBody> fetch(
          RequestOptions options, Stream<Uint8List>? stream, Future<void>? c) =>
      respond(options);
  @override
  void close({bool force = false}) {}
}

ResponseBody _json(Object body, [int status = 200]) => ResponseBody.fromString(
      jsonEncode(body),
      status,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );

Map<String, dynamic> _service(
  String id,
  String kind,
  String title, {
  String group = 'customer',
  String token = '',
  String path = '',
  String icon = 'kiosk',
}) =>
    {
      'id': id,
      'kind': kind,
      'group': group,
      'branchId': 'b1',
      'title': title,
      'description': '$title description',
      'icon': icon,
      'token': token,
      'path': path,
    };

/// A hotel tenant with one kiosk, one TV, and one staff counter.
Map<String, dynamic> _catalog({bool withServices = true}) => {
      'profile': {
        'vertical': 'business',
        'role': 'admin',
        'customerName': 'Spice Garden',
        'fullName': 'Op',
        'email': 'op@spice.test',
      },
      'branches': [
        {'id': 'b1', 'name': 'Main Kitchen', 'branchToken': 'bt1'},
      ],
      'screens': [
        {'id': 's1', 'name': 'Lobby TV', 'kind': 'queue', 'branchId': 'b1', 'screenToken': 'st1'},
      ],
      if (withServices)
        'services': [
          _service('kiosk:b1', 'kiosk', 'Ticket kiosk', token: 'bt1'),
          _service('display:s1', 'display', 'Lobby TV', token: 'st1', icon: 'display'),
          _service('counter:c1', 'web', 'Front Billing',
              group: 'staff', path: '/counter/ctok', icon: 'payments'),
          // A kind this build has never heard of must be dropped, not crash.
          _service('future:1', 'hologram', 'Hologram host'),
        ],
      'availableLanguages': ['en'],
    };

class _Server {
  _Server({this.catalog});
  final Map<String, dynamic>? catalog;
  final requests = <RequestOptions>[];

  Future<ResponseBody> handle(RequestOptions o) async {
    requests.add(o);
    switch (o.path) {
      case '/login':
        return _json({
          'session': {'accessToken': 'a', 'refreshToken': 'r', 'expiresAt': 1893456000},
          ...(catalog ?? _catalog()),
        });
      case '/provision':
        return _json(catalog ?? _catalog());
      case '/screens':
        final body = o.data as Map;
        return _json({
          'service': _service('display:new', 'display', body['name'] as String,
              token: 'st-new', icon: 'display'),
        });
    }
    return _json({'error': 'nope'}, 404);
  }

  Dio dio(String baseUrl) =>
      Dio(BaseOptions(baseUrl: '$baseUrl/api/app', validateStatus: (_) => true))
        ..httpClientAdapter = _FakeAdapter(handle);
}

class _Cfg extends DeviceConfigController {
  @override
  Future<DeviceConfig> build() => DeviceConfig.load();
}

AuthSession _session() => AuthSession(
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: DateTime.now().add(const Duration(hours: 1)),
      email: 'op@spice.test',
      fullName: 'Op',
      customerName: 'Spice Garden',
      vertical: DeviceVertical.business,
      userRole: 'admin',
    );

/// Pumps the wizard. [pin] pre-seeds an admin PIN (so a display or web service
/// finishes straight away instead of asking for one).
Future<({_Server server, ProviderContainer container})> _pump(
  WidgetTester tester, {
  _Server? server,
  bool pin = true,
  bool signedIn = false,
  bool changeMode = false,
  Map<String, Object> prefs = const {},
}) async {
  final srv = server ?? _Server();
  SharedPreferences.setMockInitialValues({
    if (pin) 'device.pinHash': 'h',
    if (pin) 'device.pinSalt': 's',
    ...prefs,
  });
  final store = InMemorySecureStore();
  if (signedIn) await _session().save(store);

  final container = ProviderContainer(overrides: [
    secureStoreProvider.overrideWithValue(store),
    deviceConfigProvider.overrideWith(_Cfg.new),
    appApiFactoryProvider.overrideWithValue((baseUrl) => AppApi(
          baseUrl: baseUrl,
          currentSession: () => null,
          onSessionRefreshed: (_) async {},
          dio: srv.dio(baseUrl),
        )),
    appApiProvider.overrideWithValue(AppApi(
      baseUrl: 'https://example.test',
      currentSession: _session,
      onSessionRefreshed: (_) async {},
      dio: srv.dio('https://example.test'),
    )),
  ]);
  addTearDown(container.dispose);
  // `_Root` never mounts the wizard before the device config has loaded, so
  // neither does the test.
  await tester.runAsync(() => container.read(deviceConfigProvider.future));

  await tester.pumpWidget(UncontrolledProviderScope(
    container: container,
    child: MaterialApp(home: SetupWizard(changeMode: changeMode)),
  ));
  await tester.pumpAndSettle();
  return (server: srv, container: container);
}

/// The picker is a scrolling list (staff screens sit below the customer-facing
/// ones), so bring an item on screen before looking for it or tapping it.
Future<void> _reveal(WidgetTester tester, String text) async {
  await tester.scrollUntilVisible(find.text(text), 200,
      scrollable: find.byType(Scrollable).first);
  await tester.pumpAndSettle();
}

Future<void> _signIn(WidgetTester tester) async {
  await tester.enterText(find.widgetWithText(TextField, 'Email'), 'op@spice.test');
  await tester.enterText(find.widgetWithText(TextField, 'Password'), 'secret');
  await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('opens on sign-in: no pairing code, no product picker', (tester) async {
    await _pump(tester);
    expect(find.text('Sign in'), findsWidgets);
    expect(find.widgetWithText(TextField, 'Email'), findsOneWidget);
    expect(find.textContaining('pairing', findRichText: true), findsNothing);
    // The server URL is tucked away, not a wizard step.
    expect(find.text('Change server'), findsOneWidget);
  });

  testWidgets('sign-in lists the server-driven services, dropping unknown kinds',
      (tester) async {
    await _pump(tester);
    await _signIn(tester);

    expect(find.text('What should this screen do?'), findsOneWidget);
    expect(find.text('Business · Spice Garden'.replaceFirst('Business', 'Hotel / Restaurant')),
        findsOneWidget);
    expect(find.text('Ticket kiosk'), findsOneWidget);
    expect(find.text('Lobby TV'), findsOneWidget);
    expect(find.text('CUSTOMER-FACING'), findsOneWidget);
    await _reveal(tester, 'Front Billing');
    expect(find.text('Front Billing'), findsOneWidget);
    expect(find.text('STAFF SCREENS'), findsOneWidget);
    expect(find.text('Hologram host'), findsNothing);
    // No product/vertical dropdown anywhere: the account decided that.
    expect(find.byType(DropdownButtonFormField<AppBranch>), findsNothing);
  });

  testWidgets('choosing a display finishes setup and binds the screen token',
      (tester) async {
    final h = await _pump(tester);
    await _signIn(tester);

    await tester.tap(find.text('Lobby TV'));
    await tester.pumpAndSettle();

    final cfg = h.container.read(deviceConfigProvider).requireValue;
    expect(cfg.setupComplete, isTrue);
    expect(cfg.role, DeviceRole.display);
    expect(cfg.vertical, DeviceVertical.business);
    expect(cfg.screenToken, 'st1');
    expect(cfg.branchToken, isEmpty);
    expect(cfg.branchId, 'b1');
    expect(cfg.serviceId, 'display:s1');
    expect(cfg.serviceTitle, 'Lobby TV');
  });

  testWidgets('a staff console becomes the web role with the full URL',
      (tester) async {
    final h = await _pump(tester);
    await _signIn(tester);

    await _reveal(tester, 'Front Billing');
    await tester.tap(find.text('Front Billing'));
    await tester.pumpAndSettle();

    final cfg = h.container.read(deviceConfigProvider).requireValue;
    expect(cfg.role, DeviceRole.web);
    expect(cfg.webUrl, endsWith('/counter/ctok'));
    expect(cfg.isComplete, isTrue);
  });

  testWidgets('a kiosk with no printer yet goes on to printer setup',
      (tester) async {
    await _pump(tester);
    await _signIn(tester);

    await tester.tap(find.text('Ticket kiosk'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));

    // Still in setup, on the printer step.
    expect(find.text('Printer'), findsWidgets);
    expect(find.text('What should this screen do?'), findsNothing);
  });

  testWidgets('a device with no PIN yet is asked for one before it starts',
      (tester) async {
    final h = await _pump(tester, pin: false);
    await _signIn(tester);

    await tester.tap(find.text('Lobby TV'));
    await tester.pumpAndSettle();

    expect(find.text('Admin PIN'), findsWidgets);
    expect(h.container.read(deviceConfigProvider).requireValue.role, isNull);
    // Cannot start until a PIN exists.
    final start = tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Start display'));
    expect(start.onPressed, isNull);
  });

  testWidgets('"New announcement display" creates a screen and binds to it',
      (tester) async {
    final h = await _pump(tester);
    await _signIn(tester);

    await tester.tap(find.text('New announcement display'));
    await tester.pumpAndSettle();
    await tester.enterText(find.widgetWithText(TextField, 'Screen name'), 'Patio TV');
    await tester.tap(find.widgetWithText(FilledButton, 'Create'));
    await tester.pumpAndSettle();

    final call = h.server.requests.singleWhere((r) => r.path == '/screens');
    expect((call.data as Map)['branchId'], 'b1');
    expect((call.data as Map)['name'], 'Patio TV');

    final cfg = h.container.read(deviceConfigProvider).requireValue;
    expect(cfg.role, DeviceRole.display);
    expect(cfg.screenToken, 'st-new');
    expect(cfg.serviceTitle, 'Patio TV');
  });

  testWidgets('a server that predates the service list still yields kiosk + display',
      (tester) async {
    final legacy = _catalog(withServices: false);
    (legacy['profile'] as Map)['vertical'] = 'school';
    (legacy['screens'] as List)
      ..clear()
      ..add({'id': 's1', 'name': 'Hall Board', 'kind': 'school', 'branchId': 'b1', 'screenToken': 'st1'});

    await _pump(tester, server: _Server(catalog: legacy));
    await _signIn(tester);

    expect(find.text('Ticket kiosk'), findsOneWidget);
    expect(find.text('Hall Board'), findsOneWidget);
  });

  testWidgets('change mode reuses the stored session — no password, marks the current service',
      (tester) async {
    final h = await _pump(
      tester,
      signedIn: true,
      changeMode: true,
      prefs: {
        'device.role': 'display',
        'device.vertical': 'business',
        'device.setupComplete': true,
        'device.screenToken': 'st1',
        'device.serviceId': 'display:s1',
        'device.serviceTitle': 'Lobby TV',
        'kiosk.baseUrl': 'https://example.test',
      },
    );

    // Straight to the picker.
    expect(find.text('What should this screen do?'), findsOneWidget);
    expect(find.widgetWithText(TextField, 'Password'), findsNothing);
    expect(find.text('Current'), findsOneWidget);
    // …and a way out that leaves the running device alone.
    expect(find.byTooltip('Keep the current setup'), findsOneWidget);
    expect(h.server.requests.any((r) => r.path == '/provision'), isTrue);
    expect(h.container.read(deviceConfigProvider).requireValue.screenToken, 'st1');
  });
}
