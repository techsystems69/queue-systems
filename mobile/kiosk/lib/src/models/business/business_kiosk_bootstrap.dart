/// Response of `GET /api/business-kiosk/[branchToken]/bootstrap` — the hotel /
/// restaurant ticket kiosk's one-time load. Mirrors `BusinessKioskPacket` in
/// lib/dal/business-app.ts (plus the `languages` the route adds).
///
/// Camel-case, like the other kiosk DTOs (the route reshapes the
/// `get_branch_data` RPC rather than passing its JSON straight through).
class BusinessKioskBootstrap {
  const BusinessKioskBootstrap({
    required this.branchId,
    required this.branchName,
    required this.businessName,
    required this.logoUrl,
    required this.queueLabel,
    required this.allowSelfJoin,
    required this.maxCapacity,
    required this.currentServingNumber,
    required this.waitingCount,
    required this.isPaused,
    required this.languages,
  });

  final String branchId;
  final String branchName;
  final String businessName;
  final String logoUrl;

  /// What this branch calls its numbers ("Queue Number", "Order No.", …).
  final String queueLabel;

  /// False = staff-entry only; the kiosk says so instead of offering a keypad
  /// that would only ever be refused.
  final bool allowSelfJoin;
  final int maxCapacity;

  final int currentServingNumber;
  final int waitingCount;
  final bool isPaused;

  /// The deployment's locale menu (`regionLocales()`), first entry = default.
  final List<String> languages;

  /// The brand line: the business, falling back to the branch.
  String get title => businessName.isNotEmpty ? businessName : branchName;

  factory BusinessKioskBootstrap.fromJson(Map<String, dynamic> json) {
    final langs = ((json['languages'] as List<dynamic>?) ?? const [])
        .whereType<String>()
        .toList();
    return BusinessKioskBootstrap(
      branchId: json['branchId'] as String? ?? '',
      branchName: json['branchName'] as String? ?? '',
      businessName: json['businessName'] as String? ?? '',
      logoUrl: json['logoUrl'] as String? ?? '',
      queueLabel: json['queueLabel'] as String? ?? 'Queue Number',
      allowSelfJoin: json['allowSelfJoin'] as bool? ?? true,
      maxCapacity: (json['maxCapacity'] as num?)?.toInt() ?? 100,
      currentServingNumber: (json['currentServingNumber'] as num?)?.toInt() ?? 0,
      waitingCount: (json['waitingCount'] as num?)?.toInt() ?? 0,
      isPaused: json['isPaused'] as bool? ?? false,
      languages: langs.isEmpty ? const ['en'] : langs,
    );
  }
}

/// Response of `GET /api/business-kiosk/[branchToken]/feed` — the slow poll.
class BusinessKioskFeed {
  const BusinessKioskFeed({
    required this.currentServingNumber,
    required this.waitingCount,
    required this.isPaused,
    required this.allowSelfJoin,
  });

  final int currentServingNumber;
  final int waitingCount;
  final bool isPaused;
  final bool allowSelfJoin;

  factory BusinessKioskFeed.fromJson(Map<String, dynamic> json) {
    return BusinessKioskFeed(
      currentServingNumber: (json['currentServingNumber'] as num?)?.toInt() ?? 0,
      waitingCount: (json['waitingCount'] as num?)?.toInt() ?? 0,
      isPaused: json['isPaused'] as bool? ?? false,
      allowSelfJoin: json['allowSelfJoin'] as bool? ?? true,
    );
  }
}
