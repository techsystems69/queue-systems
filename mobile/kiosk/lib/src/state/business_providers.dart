import 'dart:async';
import 'dart:ui' as ui;

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../announce/business_announcer.dart';
import '../api/business_display_api.dart';
import '../api/business_kiosk_api.dart';
import '../config/app_config.dart';
import '../models/business/business_board_packet.dart';
import '../models/business/business_kiosk_bootstrap.dart';
import '../models/business/business_ticket.dart';
import '../printing/print_job.dart';
import '../printing/ticket_widget.dart';
import 'providers.dart';

/// Same cadence as the school and hospital boards: announcement latency is felt
/// by whoever is waiting, and the server answers a poll from memory until a
/// number actually moves (lib/cache/businessCache.ts).
const businessBoardPollInterval = Duration(seconds: 3);

// ── Kiosk ────────────────────────────────────────────────────

final businessKioskApiProvider = Provider<BusinessKioskApi>((ref) {
  final cfg = ref.watch(deviceConfigProvider).requireValue;
  return BusinessKioskApi(
    baseUrl: cfg.baseUrl,
    branchToken: cfg.branchToken,
    onReachability: (reachable) {
      try {
        ref.read(serverLinkProvider.notifier).report(reachable: reachable);
      } catch (_) {/* provider disposed mid-request */}
    },
  );
});

final businessBootstrapProvider =
    FutureProvider<BusinessKioskBootstrap>((ref) async {
  return ref.watch(businessKioskApiProvider).bootstrap();
});

final businessFeedProvider =
    AsyncNotifierProvider<BusinessFeedController, BusinessKioskFeed>(
  BusinessFeedController.new,
);

class BusinessFeedController extends AsyncNotifier<BusinessKioskFeed> {
  Timer? _timer;

  @override
  Future<BusinessKioskFeed> build() async {
    final api = ref.watch(businessKioskApiProvider);
    _timer?.cancel();
    _timer = Timer.periodic(AppConfig.feedPollInterval, (_) => refreshNow());
    ref.onDispose(() => _timer?.cancel());
    return api.feed();
  }

  /// Keeps the last good feed on a failure — a network blip must not blank the
  /// "now serving" strip. The bootstrap/feed error path already drives the
  /// offline banner through [serverLinkProvider].
  Future<void> refreshNow() async {
    try {
      state = AsyncData(await ref.read(businessKioskApiProvider).feed());
    } catch (_) {/* keep the last good feed */}
  }
}

/// Fetched once, reused for every ticket (see [loadTicketLogo]).
final businessTicketLogoProvider = FutureProvider<ui.Image?>((ref) async {
  final bootstrap = await ref.watch(businessBootstrapProvider.future);
  return loadTicketLogo(bootstrap.logoUrl);
});

final businessKioskControllerProvider =
    Provider<BusinessKioskController>(BusinessKioskController.new);

class BusinessKioskController {
  BusinessKioskController(this.ref);
  final Ref ref;

  /// Issues a number for [billNumber], then queues the printed ticket. The row
  /// is committed server-side before the print is attempted — a printer fault
  /// never loses the number.
  Future<IssuedBusinessTicket> issue(String billNumber) async {
    final issued = await ref
        .read(businessKioskApiProvider)
        .issue(billNumber: billNumber);
    unawaited(ref.read(businessFeedProvider.notifier).refreshNow());
    _print(issued);
    return issued;
  }

  void _print(IssuedBusinessTicket issued) {
    final bootstrap = ref.read(businessBootstrapProvider).value;
    if (bootstrap == null) return;
    final ticket = issued.ticket;

    // The ticket is printed in the deployment's languages, not the guest's
    // on-screen pick: a thermal roll is short, and "Bill 1042" reads the same to
    // everyone. Arabic is the only secondary the ticket carries.
    final arabic = bootstrap.languages.contains('ar');

    ref.read(printQueueProvider).enqueue(
          PrintJob(
            data: TicketData(
              schoolNameEn: bootstrap.title,
              schoolNameAr: '',
              tokenCode: '${ticket.queueNumber}',
              departmentNameEn: 'Bill ${ticket.billNumber}',
              departmentNameAr: arabic ? 'فاتورة ${ticket.billNumber}' : '',
              isPriority: false,
              footerEn: 'Please keep this ticket.',
              footerAr: arabic ? 'يرجى الاحتفاظ بالتذكرة' : '',
              issuedAt: DateTime.now(),
              waitingAhead: issued.waitingAhead,
              builtinArabicStrings: arabic,
              logo: ref.read(businessTicketLogoProvider).value,
              // The hotel product has no public tracking page — no QR.
              publicUrl: null,
            ),
          ),
        );
  }
}

// ── Display ──────────────────────────────────────────────────

final businessDisplayApiProvider = Provider<BusinessDisplayApi>((ref) {
  final cfg = ref.watch(deviceConfigProvider).requireValue;
  return BusinessDisplayApi(baseUrl: cfg.baseUrl, screenToken: cfg.screenToken);
});

/// One announcer for the lifetime of the display screen.
final businessAnnouncerProvider = Provider<BusinessAnnouncer>((ref) {
  final announcer = BusinessAnnouncer();
  ref.onDispose(announcer.dispose);
  return announcer;
});

final businessBoardProvider =
    AsyncNotifierProvider<BusinessBoardController, BusinessBoardPacket>(
  BusinessBoardController.new,
);

class BusinessBoardController extends AsyncNotifier<BusinessBoardPacket> {
  Timer? _timer;

  @override
  Future<BusinessBoardPacket> build() async {
    final api = ref.watch(businessDisplayApiProvider);
    _timer?.cancel();
    _timer = Timer.periodic(businessBoardPollInterval, (_) => _poll());
    ref.onDispose(() => _timer?.cancel());
    return api.fetchBoard();
  }

  Future<void> _poll() async {
    try {
      state = AsyncData(await ref.read(businessDisplayApiProvider).fetchBoard());
    } catch (_) {
      // A transient failure must not blank a wall-mounted board — keep the
      // last good packet (mirrors useSupabaseQueue on the web).
    }
  }
}
