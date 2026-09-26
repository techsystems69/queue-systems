/// One issued queue number — the `entry` in the `POST …/tickets` response.
class BusinessTicket {
  const BusinessTicket({
    required this.id,
    required this.queueNumber,
    required this.billNumber,
    required this.customerName,
    required this.joinedAt,
  });

  final String id;
  final int queueNumber;
  final String billNumber;
  final String customerName;
  final String joinedAt;

  factory BusinessTicket.fromJson(Map<String, dynamic> json) {
    return BusinessTicket(
      id: json['id'] as String? ?? '',
      queueNumber: (json['queueNumber'] as num?)?.toInt() ?? 0,
      billNumber: json['billNumber'] as String? ?? '',
      customerName: json['customerName'] as String? ?? '',
      joinedAt: json['joinedAt'] as String? ?? '',
    );
  }
}

/// What issuing answers with: the committed ticket plus how many guests were
/// still ahead of it. `waitingAhead` is null when the server could not count
/// them — the printed ticket then leaves that line off.
typedef IssuedBusinessTicket = ({BusinessTicket ticket, int? waitingAhead});
