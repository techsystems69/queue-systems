import 'package:flutter/material.dart';

/// Icon for an `AppService.iconKey`. The server owns the keys (see
/// lib/dal/app-services.ts), so a key this build doesn't know — a service added
/// after the APK shipped — gets a generic tile rather than a blank one.
IconData serviceIcon(String key) => switch (key) {
      'kiosk' => Icons.confirmation_number_outlined,
      'display' => Icons.tv_rounded,
      'receipt' => Icons.receipt_long_outlined,
      'payments' => Icons.payments_outlined,
      'kitchen' => Icons.soup_kitchen_outlined,
      'delivery' => Icons.delivery_dining_outlined,
      'campaign' => Icons.campaign_outlined,
      'counter' => Icons.point_of_sale_outlined,
      'room' => Icons.medical_services_outlined,
      _ => Icons.widgets_outlined,
    };
