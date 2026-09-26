import 'package:dio/dio.dart';

import '../models/business/business_kiosk_bootstrap.dart';
import '../models/business/business_ticket.dart';
import 'api_exception.dart';

/// Thin client for the `app/api/business-kiosk/[branchToken]/*` route handlers —
/// the hotel / restaurant product. Same framing as [HospitalKioskApi] (opaque
/// branch token in the path, re-verified server-side; `{error}` body on failure;
/// 404 = unregistered) with the business DTO shapes.
class BusinessKioskApi {
  BusinessKioskApi({
    required String baseUrl,
    required this.branchToken,
    Dio? dio,
    this.onReachability,
  }) : _dio = dio ??
            Dio(BaseOptions(
              baseUrl: _normalizeBase(baseUrl),
              connectTimeout: const Duration(seconds: 8),
              receiveTimeout: const Duration(seconds: 10),
              sendTimeout: const Duration(seconds: 10),
              validateStatus: (_) => true,
              headers: {'accept': 'application/json'},
            ));

  final Dio _dio;
  final String branchToken;
  final void Function(bool reachable)? onReachability;

  static String _normalizeBase(String raw) {
    final trimmed = raw.trim().replaceAll(RegExp(r'/+$'), '');
    return trimmed.isEmpty ? trimmed : '$trimmed/api/business-kiosk';
  }

  String get _prefix => '/${Uri.encodeComponent(branchToken)}';

  Future<BusinessKioskBootstrap> bootstrap() async =>
      BusinessKioskBootstrap.fromJson(await _get('$_prefix/bootstrap'));

  Future<BusinessKioskFeed> feed() async =>
      BusinessKioskFeed.fromJson(await _get('$_prefix/feed'));

  /// Issues the next queue number for [billNumber]. The row is committed by the
  /// time this returns; printing happens afterwards, so a printer fault never
  /// loses the number.
  Future<IssuedBusinessTicket> issue({
    required String billNumber,
    String? customerName,
  }) async {
    final data = await _post('$_prefix/tickets', {
      'billNumber': billNumber,
      if (customerName != null && customerName.trim().isNotEmpty)
        'customerName': customerName.trim(),
    });
    return (
      ticket: BusinessTicket.fromJson(data['entry'] as Map<String, dynamic>),
      waitingAhead: (data['waitingAhead'] as num?)?.toInt(),
    );
  }

  Future<Map<String, dynamic>> _get(String path) async {
    try {
      return _unwrap(await _dio.get<dynamic>(path));
    } on DioException catch (e) {
      throw _fromDio(e);
    }
  }

  Future<Map<String, dynamic>> _post(String path, Object? body) async {
    try {
      return _unwrap(await _dio.post<dynamic>(path, data: body));
    } on DioException catch (e) {
      throw _fromDio(e);
    }
  }

  Map<String, dynamic> _unwrap(Response<dynamic> res) {
    onReachability?.call(true);
    final status = res.statusCode ?? 0;
    final body = res.data;
    final map = body is Map<String, dynamic> ? body : <String, dynamic>{};
    if (status >= 200 && status < 300) return map;
    throw ApiException(
      map['error'] as String? ?? 'Request failed ($status)',
      statusCode: status,
    );
  }

  ApiException _fromDio(DioException e) {
    onReachability?.call(false);
    return ApiException('Cannot reach the queue server.', isNetwork: true);
  }
}
