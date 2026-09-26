import 'package:dio/dio.dart';

import '../config/auth_session.dart';
import '../config/device_vertical.dart';
import '../models/app_service.dart';
import 'api_exception.dart';

/// One facility the signed-in operator can provision this device against.
class AppBranch {
  const AppBranch({required this.id, required this.name, required this.branchToken});
  final String id;
  final String name;
  final String branchToken;

  static AppBranch fromJson(Map<String, dynamic> j) => AppBranch(
        id: j['id'] as String,
        name: (j['name'] as String?) ?? '',
        branchToken: (j['branchToken'] as String?) ?? '',
      );
}

/// One TV screen (display role) the operator can bind this device to.
class AppScreen {
  const AppScreen({
    required this.id,
    required this.name,
    required this.kind,
    required this.branchId,
    required this.screenToken,
  });
  final String id;
  final String name;
  final String kind;
  final String branchId;
  final String screenToken;

  static AppScreen fromJson(Map<String, dynamic> j) => AppScreen(
        id: j['id'] as String,
        name: (j['name'] as String?) ?? '',
        kind: (j['kind'] as String?) ?? 'queue',
        branchId: (j['branchId'] as String?) ?? '',
        screenToken: (j['screenToken'] as String?) ?? '',
      );
}

class AppProfileSummary {
  const AppProfileSummary({
    required this.vertical,
    required this.role,
    required this.customerName,
    required this.fullName,
    required this.email,
  });
  final DeviceVertical vertical;
  final String role;
  final String customerName;
  final String fullName;
  final String email;

  static AppProfileSummary fromJson(Map<String, dynamic> j) => AppProfileSummary(
        vertical: DeviceVertical.fromStorage(j['vertical'] as String?),
        role: (j['role'] as String?) ?? '',
        customerName: (j['customerName'] as String?) ?? '',
        fullName: (j['fullName'] as String?) ?? '',
        email: (j['email'] as String?) ?? '',
      );
}

/// Everything `POST /api/app/login` hands back — the session to store plus the
/// provisioning choices, so the setup flow needs no second call.
class AppLoginResult {
  const AppLoginResult({
    required this.session,
    required this.profile,
    required this.branches,
    required this.screens,
    required this.services,
    required this.availableLanguages,
  });

  final AuthSession session;
  final AppProfileSummary profile;
  final List<AppBranch> branches;
  final List<AppScreen> screens;

  /// What the operator can turn this device into (see [AppService]).
  final List<AppService> services;
  final List<String> availableLanguages;
}

/// Provisioning payload from `GET /api/app/provision` (same shape minus session).
class AppProvision {
  const AppProvision({
    required this.profile,
    required this.branches,
    required this.screens,
    required this.services,
    required this.availableLanguages,
  });
  final AppProfileSummary profile;
  final List<AppBranch> branches;
  final List<AppScreen> screens;
  final List<AppService> services;
  final List<String> availableLanguages;
}

/// Parses the `services` array, falling back to building the native ones from
/// branches + screens when the server predates it (see [AppService.synthesize]).
List<AppService> _parseServices(
  Map<String, dynamic> map,
  AppProfileSummary profile,
  List<AppBranch> branches,
  List<AppScreen> screens,
) {
  final raw = map['services'];
  if (raw is List) {
    return raw
        .whereType<Map>()
        .map((e) => AppService.tryParse(e.cast<String, dynamic>()))
        .whereType<AppService>()
        .toList();
  }
  return AppService.synthesize(
    vertical: profile.vertical,
    branches: [for (final b in branches) (id: b.id, name: b.name, token: b.branchToken)],
    screens: [
      for (final s in screens)
        (id: s.id, name: s.name, branchId: s.branchId, kind: s.kind, token: s.screenToken),
    ],
  );
}

/// The tenant's server-side settings row, plus the deployment locale menu. The
/// raw map is kept as-is and read through the descriptor-driven settings form.
class TenantSettings {
  const TenantSettings({
    required this.vertical,
    required this.settings,
    required this.availableLanguages,
  });
  final DeviceVertical vertical;
  final Map<String, dynamic>? settings;
  final List<String> availableLanguages;

  static TenantSettings fromJson(Map<String, dynamic> j) => TenantSettings(
        vertical: DeviceVertical.fromStorage(j['vertical'] as String?),
        settings: (j['settings'] as Map?)?.cast<String, dynamic>(),
        availableLanguages:
            ((j['availableLanguages'] as List?) ?? const []).cast<String>(),
      );
}

/// Client for the native-app auth + settings routes (`app/api/app/*`).
///
/// [login] and [refresh] are unauthenticated. [provision] / [getSettings] /
/// [saveSettings] send the stored access token as a Bearer header, and on a 401
/// try one silent refresh + retry before giving up and calling [onAuthExpired].
class AppApi {
  AppApi({
    required String baseUrl,
    required this.currentSession,
    required this.onSessionRefreshed,
    this.onAuthExpired,
    Dio? dio,
  })  : _dio = dio ??
            Dio(BaseOptions(
              baseUrl: _normalizeBase(baseUrl),
              connectTimeout: const Duration(seconds: 8),
              receiveTimeout: const Duration(seconds: 12),
              sendTimeout: const Duration(seconds: 12),
              validateStatus: (_) => true,
              headers: {'accept': 'application/json'},
            ));

  final Dio _dio;

  /// The session in effect right now (provider-owned). May be null.
  final AuthSession? Function() currentSession;

  /// Persist a session produced by a silent refresh.
  final Future<void> Function(AuthSession) onSessionRefreshed;

  /// Refresh failed — the operator must sign in again. The device keeps running.
  final void Function()? onAuthExpired;

  static String _normalizeBase(String raw) {
    final trimmed = raw.trim().replaceAll(RegExp(r'/+$'), '');
    return trimmed.isEmpty ? trimmed : '$trimmed/api/app';
  }

  // ── Unauthenticated ────────────────────────────────────────

  Future<AppLoginResult> login({
    required String email,
    required String password,
  }) async {
    final map = await _post('/login', {'email': email.trim(), 'password': password});
    final s = map['session'] as Map<String, dynamic>;
    final profile = AppProfileSummary.fromJson(map['profile'] as Map<String, dynamic>);
    final branches = _parseBranches(map);
    final screens = _parseScreens(map);
    return AppLoginResult(
      session: AuthSession(
        accessToken: s['accessToken'] as String,
        refreshToken: s['refreshToken'] as String,
        expiresAt: AuthSession.expiresAtFromSeconds(s['expiresAt']),
        email: profile.email,
        fullName: profile.fullName,
        customerName: profile.customerName,
        vertical: profile.vertical,
        userRole: profile.role,
      ),
      profile: profile,
      branches: branches,
      screens: screens,
      services: _parseServices(map, profile, branches, screens),
      availableLanguages:
          ((map['availableLanguages'] as List?) ?? const []).cast<String>(),
    );
  }

  Future<AuthSession> refresh(String refreshToken) async {
    final map = await _post('/refresh', {'refreshToken': refreshToken});
    final s = map['session'] as Map<String, dynamic>;
    final base = currentSession();
    final refreshed = (base ??
            AuthSession(
              accessToken: '',
              refreshToken: '',
              expiresAt: DateTime.now(),
              email: '',
              fullName: '',
              customerName: '',
              vertical: DeviceVertical.business,
              userRole: '',
            ))
        .copyWith(
      accessToken: s['accessToken'] as String,
      refreshToken: s['refreshToken'] as String,
      expiresAt: AuthSession.expiresAtFromSeconds(s['expiresAt']),
    );
    return refreshed;
  }

  // ── Authenticated ──────────────────────────────────────────

  Future<AppProvision> provision() async {
    final map = await _authedGet('/provision');
    final profile = AppProfileSummary.fromJson(map['profile'] as Map<String, dynamic>);
    final branches = _parseBranches(map);
    final screens = _parseScreens(map);
    return AppProvision(
      profile: profile,
      branches: branches,
      screens: screens,
      services: _parseServices(map, profile, branches, screens),
      availableLanguages:
          ((map['availableLanguages'] as List?) ?? const []).cast<String>(),
    );
  }

  /// Creates a TV screen on [branchId] and answers with it as a display
  /// service — so picking "Announcement display" never needs the dashboard.
  /// The server enforces the plan's screen quota and says so in the error.
  Future<AppService> createDisplay({
    required String branchId,
    required String name,
  }) async {
    final map = await _authedRequest(
      () => _dio.post<dynamic>('/screens', data: {'branchId': branchId, 'name': name}),
    );
    final service =
        AppService.tryParse((map['service'] as Map).cast<String, dynamic>());
    if (service == null) throw ApiException('The server sent an unreadable screen.');
    return service;
  }

  Future<TenantSettings> getSettings({required String branchId}) async {
    final map = await _authedGet('/settings', query: {'branchId': branchId});
    return TenantSettings.fromJson(map);
  }

  Future<TenantSettings> saveSettings({
    required String branchId,
    required Map<String, dynamic> patch,
  }) async {
    final map = await _authedRequest(
      () => _dio.patch<dynamic>(
        '/settings',
        queryParameters: {'branchId': branchId},
        data: patch,
      ),
    );
    return TenantSettings.fromJson(map);
  }

  static List<AppBranch> _parseBranches(Map<String, dynamic> map) =>
      ((map['branches'] as List?) ?? const [])
          .map((e) => AppBranch.fromJson((e as Map).cast<String, dynamic>()))
          .toList();

  static List<AppScreen> _parseScreens(Map<String, dynamic> map) =>
      ((map['screens'] as List?) ?? const [])
          .map((e) => AppScreen.fromJson((e as Map).cast<String, dynamic>()))
          .toList();

  // ── Plumbing ───────────────────────────────────────────────

  Future<Map<String, dynamic>> _post(String path, Object body) async {
    try {
      final res = await _dio.post<dynamic>(path, data: body);
      return _unwrap(res);
    } on DioException {
      throw ApiException('Cannot reach the queue server.', isNetwork: true);
    }
  }

  Future<Map<String, dynamic>> _authedGet(
    String path, {
    Map<String, dynamic>? query,
  }) {
    return _authedRequest(
      () => _dio.get<dynamic>(path, queryParameters: query),
    );
  }

  /// Runs an authenticated request; on 401 tries a single silent refresh + retry.
  Future<Map<String, dynamic>> _authedRequest(
    Future<Response<dynamic>> Function() send,
  ) async {
    final session = currentSession();
    if (session == null) {
      onAuthExpired?.call();
      throw ApiException('Sign in to continue.', statusCode: 401);
    }

    Future<Response<dynamic>> withToken(String token) {
      _dio.options.headers['authorization'] = 'Bearer $token';
      return send();
    }

    try {
      var res = await withToken(session.accessToken);
      if (res.statusCode == 401) {
        final refreshed = await _trySilentRefresh(session);
        if (refreshed == null) {
          onAuthExpired?.call();
          throw ApiException('Session expired. Sign in again.', statusCode: 401);
        }
        res = await withToken(refreshed.accessToken);
      }
      return _unwrap(res);
    } on DioException {
      throw ApiException('Cannot reach the queue server.', isNetwork: true);
    } finally {
      _dio.options.headers.remove('authorization');
    }
  }

  Future<AuthSession?> _trySilentRefresh(AuthSession session) async {
    try {
      final refreshed = await refresh(session.refreshToken);
      await onSessionRefreshed(refreshed);
      return refreshed;
    } catch (_) {
      return null;
    }
  }

  Map<String, dynamic> _unwrap(Response<dynamic> res) {
    final status = res.statusCode ?? 0;
    final body = res.data;
    final map = body is Map<String, dynamic>
        ? body
        : body is Map
            ? body.cast<String, dynamic>()
            : <String, dynamic>{};
    if (status < 200 || status >= 300) {
      throw ApiException(
        map['error'] as String? ?? 'Request failed ($status)',
        statusCode: status,
      );
    }
    return map;
  }
}
