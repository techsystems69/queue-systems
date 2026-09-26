import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:school_kiosk/src/api/api_exception.dart';
import 'package:school_kiosk/src/api/app_api.dart';
import 'package:school_kiosk/src/config/auth_session.dart';
import 'package:school_kiosk/src/config/device_vertical.dart';
import 'package:school_kiosk/src/models/app_service.dart';

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

ResponseBody _json(Object body, int status) => ResponseBody.fromString(
      jsonEncode(body),
      status,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );

Dio _dio(Future<ResponseBody> Function(RequestOptions) respond) => Dio(
      BaseOptions(baseUrl: 'https://x/api/app', validateStatus: (_) => true),
    )..httpClientAdapter = _FakeAdapter(respond);

AuthSession _session({String access = 'a1', String refresh = 'r1'}) => AuthSession(
      accessToken: access,
      refreshToken: refresh,
      expiresAt: DateTime.now().add(const Duration(hours: 1)),
      email: 'op@x.com',
      fullName: 'Op',
      customerName: 'Ruby Hall',
      vertical: DeviceVertical.hospital,
      userRole: 'admin',
    );

void main() {
  test('login parses session / profile / branches / screens', () async {
    final api = AppApi(
      baseUrl: 'https://x',
      currentSession: () => null,
      onSessionRefreshed: (_) async {},
      dio: _dio((o) async => _json({
            'session': {
              'accessToken': 'acc',
              'refreshToken': 'ref',
              'expiresAt': 1893456000,
            },
            'profile': {
              'vertical': 'hospital',
              'role': 'admin',
              'customerName': 'Ruby Hall',
              'fullName': 'Op Erator',
              'email': 'op@x.com',
            },
            'branches': [
              {'id': 'b1', 'name': 'Main', 'branchToken': 'bt1'},
            ],
            'screens': [
              {'id': 's1', 'name': 'Lobby', 'kind': 'hospital', 'branchId': 'b1', 'screenToken': 'st1'},
            ],
            'availableLanguages': ['en', 'mr'],
          }, 200)),
    );

    final r = await api.login(email: 'op@x.com', password: 'secret');
    expect(r.session.accessToken, 'acc');
    expect(r.session.refreshToken, 'ref');
    expect(r.profile.vertical, DeviceVertical.hospital);
    expect(r.branches.single.branchToken, 'bt1');
    expect(r.screens.single.screenToken, 'st1');
    // A server that predates the service list: kiosk + display are synthesized.
    expect(r.services.map((s) => s.id), ['kiosk:b1', 'display:s1']);
    expect(r.availableLanguages, ['en', 'mr']);
  });

  test('bad credentials surface the server message with status 401', () async {
    final api = AppApi(
      baseUrl: 'https://x',
      currentSession: () => null,
      onSessionRefreshed: (_) async {},
      dio: _dio((o) async => _json({'error': 'Invalid email or password.'}, 401)),
    );
    expect(
      () => api.login(email: 'x@y.z', password: 'nope'),
      throwsA(isA<ApiException>()
          .having((e) => e.statusCode, 'statusCode', 401)
          .having((e) => e.message, 'message', 'Invalid email or password.')),
    );
  });

  test('a 401 on getSettings triggers one refresh + retry', () async {
    var session = _session(access: 'stale', refresh: 'r1');
    var settingsCalls = 0;
    var refreshCalls = 0;
    AuthSession? persisted;

    final api = AppApi(
      baseUrl: 'https://x',
      currentSession: () => session,
      onSessionRefreshed: (s) async {
        persisted = s;
        session = s;
      },
      dio: _dio((o) async {
        if (o.path == '/refresh') {
          refreshCalls++;
          return _json({
            'session': {'accessToken': 'fresh', 'refreshToken': 'r2', 'expiresAt': 1893456000},
          }, 200);
        }
        // /settings
        settingsCalls++;
        final auth = o.headers['authorization'];
        if (auth == 'Bearer fresh') {
          return _json({'vertical': 'hospital', 'settings': {'kioskIdleSeconds': 20}, 'availableLanguages': ['en']}, 200);
        }
        return _json({'error': 'Session expired.'}, 401);
      }),
    );

    final result = await api.getSettings(branchId: 'b1');
    expect(refreshCalls, 1);
    expect(settingsCalls, 2);
    expect(persisted?.accessToken, 'fresh');
    expect(result.settings!['kioskIdleSeconds'], 20);
  });

  test('a failed refresh fires onAuthExpired and throws 401', () async {
    var expired = false;
    final api = AppApi(
      baseUrl: 'https://x',
      currentSession: () => _session(),
      onSessionRefreshed: (_) async {},
      onAuthExpired: () => expired = true,
      dio: _dio((o) async {
        if (o.path == '/refresh') return _json({'error': 'gone'}, 401);
        return _json({'error': 'Session expired.'}, 401);
      }),
    );

    await expectLater(
      () => api.provision(),
      throwsA(isA<ApiException>().having((e) => e.statusCode, 'statusCode', 401)),
    );
    expect(expired, isTrue);
  });

  test('403 from the settings route surfaces verbatim', () async {
    final api = AppApi(
      baseUrl: 'https://x',
      currentSession: () => _session(),
      onSessionRefreshed: (_) async {},
      dio: _dio((o) async => _json({'error': 'You do not have access to this branch.'}, 403)),
    );
    expect(
      () => api.getSettings(branchId: 'b9'),
      throwsA(isA<ApiException>()
          .having((e) => e.statusCode, 'statusCode', 403)
          .having((e) => e.message, 'message', 'You do not have access to this branch.')),
    );
  });

  test('login reads the server-driven services and skips kinds it does not know',
      () async {
    final api = AppApi(
      baseUrl: 'https://x',
      currentSession: () => null,
      onSessionRefreshed: (_) async {},
      dio: _dio((o) async => _json({
            'session': {'accessToken': 'a', 'refreshToken': 'r', 'expiresAt': 1893456000},
            'profile': {
              'vertical': 'business',
              'role': 'admin',
              'customerName': 'Spice Garden',
              'fullName': 'Op',
              'email': 'op@x.com',
            },
            'branches': [
              {'id': 'b1', 'name': 'Main', 'branchToken': 'bt1'},
            ],
            'screens': const [],
            'services': [
              {
                'id': 'counter:c1',
                'kind': 'web',
                'group': 'staff',
                'branchId': 'b1',
                'title': 'Kitchen',
                'description': 'Kitchen display for the prep queue.',
                'icon': 'kitchen',
                'token': '',
                'path': '/counter/abc',
              },
              {'id': 'x', 'kind': 'hologram', 'title': 'Future'},
            ],
            'availableLanguages': ['en'],
          }, 200)),
    );

    final r = await api.login(email: 'op@x.com', password: 'secret');
    final s = r.services.single;
    expect(s.kind, AppServiceKind.web);
    expect(s.group, AppServiceGroup.staff);
    expect(s.webUrl('https://host.test/'), 'https://host.test/counter/abc');
  });

  test('business against a server with no service list yields nothing to pick',
      () async {
    final api = AppApi(
      baseUrl: 'https://x',
      currentSession: () => null,
      onSessionRefreshed: (_) async {},
      dio: _dio((o) async => _json({
            'session': {'accessToken': 'a', 'refreshToken': 'r', 'expiresAt': 1893456000},
            'profile': {
              'vertical': 'business',
              'role': 'admin',
              'customerName': 'x',
              'fullName': 'x',
              'email': 'x@x.com',
            },
            'branches': [
              {'id': 'b1', 'name': 'Main', 'branchToken': 'bt1'},
            ],
            'screens': const [],
            'availableLanguages': ['en'],
          }, 200)),
    );
    final r = await api.login(email: 'x@x.com', password: 'secret');
    expect(r.services, isEmpty);
  });

  test('createDisplay posts branchId + name and returns the display service',
      () async {
    RequestOptions? seen;
    final api = AppApi(
      baseUrl: 'https://x',
      currentSession: () => _session(),
      onSessionRefreshed: (_) async {},
      dio: _dio((o) async {
        seen = o;
        return _json({
          'service': {
            'id': 'display:s9',
            'kind': 'display',
            'group': 'customer',
            'branchId': 'b1',
            'title': 'Patio TV',
            'description': 'd',
            'icon': 'display',
            'token': 'st9',
            'path': '',
          },
        }, 200);
      }),
    );

    final s = await api.createDisplay(branchId: 'b1', name: 'Patio TV');
    expect(seen!.path, '/screens');
    expect(seen!.headers['authorization'], 'Bearer a1');
    expect((seen!.data as Map)['name'], 'Patio TV');
    expect(s.token, 'st9');
    expect(s.role.name, 'display');
  });

  test('createDisplay surfaces the plan-limit message', () async {
    final api = AppApi(
      baseUrl: 'https://x',
      currentSession: () => _session(),
      onSessionRefreshed: (_) async {},
      dio: _dio((o) async => _json({
            'error': 'You have reached the maximum number of screens (2) for this branch on your plan.',
          }, 400)),
    );
    expect(
      () => api.createDisplay(branchId: 'b1', name: 'Third'),
      throwsA(isA<ApiException>()
          .having((e) => e.message, 'message', contains('maximum number of screens'))),
    );
  });
}
