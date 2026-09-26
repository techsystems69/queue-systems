import 'package:shared_preferences/shared_preferences.dart';

import '../printing/printer_settings.dart';
import 'app_config.dart';
import 'device_role.dart';
import 'device_vertical.dart';

/// Per-device provisioning, persisted in SharedPreferences so it survives
/// restarts. Replaces the old two-field `KioskConfig` with a role-based
/// config, while keeping every key that config used to write — an
/// already-deployed kiosk tablet must come back up as a kiosk after an app
/// update with no re-provisioning step (see [load]'s migration branch).
class DeviceConfig {
  const DeviceConfig({
    required this.baseUrl,
    required this.role,
    required this.setupComplete,
    required this.branchToken,
    required this.screenToken,
    required this.webUrl,
    required this.adminPinHash,
    required this.adminPinSalt,
    required this.adminPinLength,
    required this.printer,
    this.vertical = DeviceVertical.business,
    this.defaultLocale = '',
    this.branchId = '',
    this.serviceId = '',
    this.serviceTitle = '',
  });

  final String baseUrl;
  final DeviceRole? role;

  /// Device-local default kiosk language (a `regionLocales()` code). Empty ⇒
  /// fall back to the server's first configured language. Set from the Settings
  /// screen; not part of provisioning, so [clearProvisioning] leaves it alone.
  final String defaultLocale;

  /// Which product the paired branch/screen belongs to — decides which screen
  /// [_Root] shows and which API base path the clients use. Defaults to
  /// `business` so a pre-vertical pairing payload keeps working.
  final DeviceVertical vertical;
  final bool setupComplete;

  /// Kiosk role.
  final String branchToken;

  /// Display role.
  final String screenToken;

  /// Web role.
  final String webUrl;

  /// The facility this device serves. Captured at sign-in provisioning so the
  /// Settings screen can read/write the tenant's branch-scoped settings without
  /// a lookup. Empty for a pre-login (migrated) device or the web role.
  final String branchId;

  /// Which catalog entry (`AppService.id`) the operator turned this device into,
  /// and the title they saw for it. Purely descriptive — the role and tokens
  /// above are what actually drive the screen — so Settings can say "Lobby TV"
  /// and the picker can mark the current choice. Empty on a device provisioned
  /// before the service list existed.
  final String serviceId;
  final String serviceTitle;

  final String? adminPinHash;
  final String? adminPinSalt;
  final int adminPinLength;

  final PrinterSettings printer;

  /// True once the role's own token/url is present — used by the setup wizard
  /// to know a step can be skipped when re-entering settings.
  bool get isComplete {
    if (baseUrl.trim().isEmpty) return false;
    return switch (role) {
      DeviceRole.kiosk => branchToken.trim().isNotEmpty,
      DeviceRole.display => screenToken.trim().isNotEmpty,
      DeviceRole.web => webUrl.trim().isNotEmpty,
      null => false,
    };
  }

  bool get hasPin => (adminPinHash ?? '').isNotEmpty;

  static const _kBaseUrl = 'kiosk.baseUrl';
  static const _kBranchToken = 'kiosk.branchToken';
  static const _kBranchId = 'device.branchId';
  static const _kServiceId = 'device.serviceId';
  static const _kServiceTitle = 'device.serviceTitle';
  static const _kRole = 'device.role';
  static const _kVertical = 'device.vertical';
  static const _kScreenToken = 'device.screenToken';
  static const _kWebUrl = 'device.webUrl';
  static const _kPinHash = 'device.pinHash';
  static const _kPinSalt = 'device.pinSalt';
  static const _kPinLength = 'device.pinLength';
  static const _kPrinter = 'device.printer';
  static const _kSetupComplete = 'device.setupComplete';
  static const _kDefaultLocale = 'device.defaultLocale';

  static Future<DeviceConfig> load() async {
    final prefs = await SharedPreferences.getInstance();
    final storedRole = DeviceRole.fromStorage(prefs.getString(_kRole));
    final legacyBranchToken = prefs.getString(_kBranchToken) ?? '';

    // Migration: an app installed before roles existed has `device.role`
    // absent but a real kiosk branch token already saved. Treat that as an
    // already-provisioned kiosk rather than sending it back to setup.
    final role = storedRole ??
        (legacyBranchToken.trim().isNotEmpty ? DeviceRole.kiosk : null);
    final setupComplete = prefs.getBool(_kSetupComplete) ??
        (storedRole == null && legacyBranchToken.trim().isNotEmpty);

    return DeviceConfig(
      baseUrl: prefs.getString(_kBaseUrl) ?? AppConfig.defaultBaseUrl,
      role: role,
      vertical: DeviceVertical.fromStorage(prefs.getString(_kVertical)),
      setupComplete: setupComplete,
      branchToken: legacyBranchToken,
      screenToken: prefs.getString(_kScreenToken) ?? '',
      webUrl: prefs.getString(_kWebUrl) ?? '',
      adminPinHash: prefs.getString(_kPinHash),
      adminPinSalt: prefs.getString(_kPinSalt),
      adminPinLength: prefs.getInt(_kPinLength) ?? 4,
      printer: PrinterSettings.decode(prefs.getString(_kPrinter)),
      defaultLocale: prefs.getString(_kDefaultLocale) ?? '',
      branchId: prefs.getString(_kBranchId) ?? '',
      serviceId: prefs.getString(_kServiceId) ?? '',
      serviceTitle: prefs.getString(_kServiceTitle) ?? '',
    );
  }

  Future<void> save() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kBaseUrl, baseUrl.trim());
    if (role != null) await prefs.setString(_kRole, role!.storageValue);
    await prefs.setString(_kVertical, vertical.storageValue);
    await prefs.setBool(_kSetupComplete, setupComplete);
    await prefs.setString(_kBranchToken, branchToken.trim());
    await prefs.setString(_kBranchId, branchId.trim());
    await prefs.setString(_kServiceId, serviceId);
    await prefs.setString(_kServiceTitle, serviceTitle);
    await prefs.setString(_kScreenToken, screenToken.trim());
    await prefs.setString(_kWebUrl, webUrl.trim());
    if (adminPinHash != null) await prefs.setString(_kPinHash, adminPinHash!);
    if (adminPinSalt != null) await prefs.setString(_kPinSalt, adminPinSalt!);
    await prefs.setInt(_kPinLength, adminPinLength);
    await prefs.setString(_kPrinter, printer.encode());
    await prefs.setString(_kDefaultLocale, defaultLocale.trim());
  }

  /// Wipe provisioning (role + tokens) but keep the server URL and the admin
  /// PIN — a staff member fixing a bad token shouldn't be locked out of their
  /// own device or have to re-type the deployment URL.
  static Future<void> clearProvisioning() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_kRole);
    await prefs.remove(_kVertical);
    await prefs.remove(_kBranchToken);
    await prefs.remove(_kBranchId);
    await prefs.remove(_kServiceId);
    await prefs.remove(_kServiceTitle);
    await prefs.remove(_kScreenToken);
    await prefs.remove(_kWebUrl);
    await prefs.remove(_kSetupComplete);
  }

  DeviceConfig copyWith({
    String? baseUrl,
    DeviceRole? role,
    DeviceVertical? vertical,
    bool? setupComplete,
    String? branchToken,
    String? branchId,
    String? screenToken,
    String? webUrl,
    String? adminPinHash,
    String? adminPinSalt,
    int? adminPinLength,
    PrinterSettings? printer,
    String? defaultLocale,
    String? serviceId,
    String? serviceTitle,
  }) {
    return DeviceConfig(
      baseUrl: baseUrl ?? this.baseUrl,
      role: role ?? this.role,
      vertical: vertical ?? this.vertical,
      setupComplete: setupComplete ?? this.setupComplete,
      branchToken: branchToken ?? this.branchToken,
      branchId: branchId ?? this.branchId,
      screenToken: screenToken ?? this.screenToken,
      webUrl: webUrl ?? this.webUrl,
      adminPinHash: adminPinHash ?? this.adminPinHash,
      adminPinSalt: adminPinSalt ?? this.adminPinSalt,
      adminPinLength: adminPinLength ?? this.adminPinLength,
      printer: printer ?? this.printer,
      defaultLocale: defaultLocale ?? this.defaultLocale,
      serviceId: serviceId ?? this.serviceId,
      serviceTitle: serviceTitle ?? this.serviceTitle,
    );
  }
}
