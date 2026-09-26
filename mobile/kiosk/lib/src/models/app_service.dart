import '../config/device_role.dart';
import '../config/device_vertical.dart';

/// What kind of screen an [AppService] turns the device into.
///
/// `kiosk` and `display` have native screens; `web` opens a server path in a
/// full-screen web view — that is how a new hotel service ships without an APK
/// release. A `kind` this build has never heard of is dropped by [tryParse]
/// (the server may be newer than the app), never shown as a broken card.
enum AppServiceKind { kiosk, display, web }

/// Customer-facing services (kiosk, boards) vs. staff working consoles — the
/// picker lists them under separate headings.
enum AppServiceGroup { customer, staff }

/// One entry in the "choose a service" list. Mirrors `AppService` in
/// lib/dal/app-services.ts.
class AppService {
  const AppService({
    required this.id,
    required this.kind,
    required this.group,
    required this.branchId,
    required this.title,
    required this.description,
    required this.iconKey,
    required this.token,
    required this.path,
  });

  final String id;
  final AppServiceKind kind;
  final AppServiceGroup group;
  final String branchId;
  final String title;
  final String description;

  /// A key the picker maps to an icon; unknown keys get a generic one.
  final String iconKey;

  /// kiosk: branch token. display: screen token. web: empty.
  final String token;

  /// web only: a server-relative path such as `/counter/<token>`.
  final String path;

  /// The role the device is locked to when this service is chosen.
  DeviceRole get role => switch (kind) {
        AppServiceKind.kiosk => DeviceRole.kiosk,
        AppServiceKind.display => DeviceRole.display,
        AppServiceKind.web => DeviceRole.web,
      };

  /// The full page a `web` service opens, given the deployment's base URL.
  String webUrl(String baseUrl) {
    final base = baseUrl.trim().replaceAll(RegExp(r'/+$'), '');
    return '$base${path.startsWith('/') ? path : '/$path'}';
  }

  static AppService? tryParse(Map<String, dynamic> j) {
    final kind = switch (j['kind']) {
      'kiosk' => AppServiceKind.kiosk,
      'display' => AppServiceKind.display,
      'web' => AppServiceKind.web,
      _ => null,
    };
    if (kind == null) return null;
    return AppService(
      id: j['id'] as String? ?? '',
      kind: kind,
      group: j['group'] == 'staff' ? AppServiceGroup.staff : AppServiceGroup.customer,
      branchId: j['branchId'] as String? ?? '',
      title: j['title'] as String? ?? '',
      description: j['description'] as String? ?? '',
      iconKey: j['icon'] as String? ?? '',
      token: j['token'] as String? ?? '',
      path: j['path'] as String? ?? '',
    );
  }

  /// A server that predates the service list still returns branches + screens.
  /// Build the two native services from those so a school or hospital tenant
  /// isn't locked out by an APK that is newer than their deployment. Business
  /// has no native routes on such a server, so it yields nothing there.
  static List<AppService> synthesize({
    required DeviceVertical vertical,
    required List<({String id, String name, String token})> branches,
    required List<({String id, String name, String branchId, String kind, String token})> screens,
  }) {
    if (vertical == DeviceVertical.business) return const [];
    final displayKind = vertical == DeviceVertical.hospital ? 'hospital' : 'school';
    return [
      for (final b in branches)
        AppService(
          id: 'kiosk:${b.id}',
          kind: AppServiceKind.kiosk,
          group: AppServiceGroup.customer,
          branchId: b.id,
          title: 'Ticket kiosk',
          description: vertical == DeviceVertical.hospital
              ? 'Patients pick a department or doctor and get a token.'
              : 'Visitors pick a department and get a printed token.',
          iconKey: 'kiosk',
          token: b.token,
          path: '',
        ),
      for (final s in screens)
        if (s.kind == displayKind)
          AppService(
            id: 'display:${s.id}',
            kind: AppServiceKind.display,
            group: AppServiceGroup.customer,
            branchId: s.branchId,
            title: s.name,
            description: 'Announcement display — shows and announces called numbers.',
            iconKey: 'display',
            token: s.token,
            path: '',
          ),
    ];
  }
}
