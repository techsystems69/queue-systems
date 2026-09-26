import '../board_packet.dart' show BoardAd, BoardTickerRow;

/// Response of `GET /api/business-display/[screenToken]`. Mirrors
/// `BusinessBoardPacket` in lib/dal/business-app.ts.
///
/// Ads and ticker rows deliberately reuse the school board's [BoardAd] /
/// [BoardTickerRow], so the ad rail and ticker widgets serve every product.
class BusinessBoardPacket {
  const BusinessBoardPacket({
    required this.status,
    required this.screenName,
    required this.branchName,
    required this.businessName,
    required this.logoUrl,
    required this.queueLabel,
    required this.tickerText,
    required this.currentServingNumber,
    required this.isPaused,
    required this.serving,
    required this.next,
    required this.waitingCount,
    required this.ads,
    required this.tickers,
    required this.showAds,
    required this.showTicker,
    required this.showClock,
    required this.announcementLang,
  });

  /// 'ok' | 'not-found' | 'expired' (the last two arrive as HTTP 404).
  final String status;
  final String screenName;
  final String branchName;
  final String businessName;
  final String logoUrl;
  final String queueLabel;
  final String tickerText;
  final int currentServingNumber;
  final bool isPaused;

  /// The guest at a counter right now, or null between calls.
  final BusinessServing? serving;

  /// The next few numbers, lowest first.
  final List<BusinessQueueEntry> next;
  final int waitingCount;

  final List<BoardAd> ads;
  final List<BoardTickerRow> tickers;
  final bool showAds;
  final bool showTicker;
  final bool showClock;

  /// 'en' | 'ar' | 'both'.
  final String announcementLang;

  bool get isOk => status == 'ok';

  /// The brand line: the business, falling back to the branch.
  String get title => businessName.isNotEmpty ? businessName : branchName;

  factory BusinessBoardPacket.fromJson(Map<String, dynamic> json) {
    final servingJson = json['serving'];
    final settings = (json['settings'] as Map<String, dynamic>?) ?? const {};
    return BusinessBoardPacket(
      status: json['status'] as String? ?? 'not-found',
      screenName: json['screenName'] as String? ?? '',
      branchName: json['branchName'] as String? ?? '',
      businessName: json['businessName'] as String? ?? '',
      logoUrl: json['logoUrl'] as String? ?? '',
      queueLabel: json['queueLabel'] as String? ?? 'Queue Number',
      tickerText: json['tickerText'] as String? ?? '',
      currentServingNumber: (json['currentServingNumber'] as num?)?.toInt() ?? 0,
      isPaused: json['isPaused'] as bool? ?? false,
      serving: servingJson is Map<String, dynamic>
          ? BusinessServing.fromJson(servingJson)
          : null,
      next: ((json['next'] as List<dynamic>?) ?? const [])
          .map((e) => BusinessQueueEntry.fromJson(e as Map<String, dynamic>))
          .toList(),
      waitingCount: (json['waitingCount'] as num?)?.toInt() ?? 0,
      ads: ((json['ads'] as List<dynamic>?) ?? const [])
          .map((e) => _ad(e as Map<String, dynamic>))
          .toList(),
      tickers: ((json['tickers'] as List<dynamic>?) ?? const [])
          .map((e) => BoardTickerRow.fromJson(e as Map<String, dynamic>))
          .toList(),
      showAds: settings['showAds'] as bool? ?? true,
      showTicker: settings['showTicker'] as bool? ?? true,
      showClock: settings['showClock'] as bool? ?? true,
      announcementLang: settings['announcementLang'] as String? ?? 'en',
    );
  }

  // This route is camelCase, [BoardAd.fromJson] reads the school RPC's
  // snake_case rows — so build the ad by hand.
  static BoardAd _ad(Map<String, dynamic> j) => BoardAd(
        id: j['id'] as String? ?? '',
        fileUrl: j['fileUrl'] as String? ?? '',
        fileType: j['fileType'] as String? ?? 'image',
        durationSeconds: (j['durationSeconds'] as num?)?.toInt() ?? 8,
        isActive: true,
        audioEnabled: j['audioEnabled'] as bool? ?? false,
        placement: 'side',
      );
}

class BusinessQueueEntry {
  const BusinessQueueEntry({required this.queueNumber, required this.billNumber});
  final int queueNumber;
  final String billNumber;

  factory BusinessQueueEntry.fromJson(Map<String, dynamic> json) {
    return BusinessQueueEntry(
      queueNumber: (json['queueNumber'] as num?)?.toInt() ?? 0,
      billNumber: json['billNumber'] as String? ?? '',
    );
  }
}

/// The entry being served. [callKey] changes on every call *and* recall (the
/// server bumps `callCount` for both), which is exactly when the board must
/// announce.
class BusinessServing extends BusinessQueueEntry {
  const BusinessServing({
    required this.entryId,
    required super.queueNumber,
    required super.billNumber,
    required this.callCount,
  });
  final String entryId;
  final int callCount;

  String get callKey => '$entryId:$callCount';

  factory BusinessServing.fromJson(Map<String, dynamic> json) {
    return BusinessServing(
      entryId: json['entryId'] as String? ?? '',
      queueNumber: (json['queueNumber'] as num?)?.toInt() ?? 0,
      billNumber: json['billNumber'] as String? ?? '',
      callCount: (json['callCount'] as num?)?.toInt() ?? 0,
    );
  }
}
