import 'package:flutter/material.dart';

import '../../api/api_exception.dart';
import '../theme.dart';

/// What a hotel kiosk/board shows when its first load fails: either the network
/// is down (retry, and the screen retries on its own) or the token is no longer
/// valid (the operator must set the device up again).
class BusinessBootError extends StatelessWidget {
  const BusinessBootError({
    super.key,
    required this.error,
    required this.what,
    required this.onRetry,
    required this.onSetUpAgain,
  });

  final Object error;

  /// "kiosk" / "display" — for the unregistered message.
  final String what;
  final VoidCallback onRetry;
  final VoidCallback onSetUpAgain;

  @override
  Widget build(BuildContext context) {
    final unregistered =
        error is ApiException && (error as ApiException).isUnregistered;
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 480),
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                unregistered ? Icons.link_off_rounded : Icons.wifi_off_rounded,
                size: 48,
                color: KioskPalette.inkFaint,
              ),
              const SizedBox(height: 18),
              Text(
                unregistered
                    ? 'This $what is no longer registered'
                    : 'Cannot reach the queue server',
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                unregistered
                    ? 'Ask a manager to set this device up again.'
                    : 'Retrying automatically…',
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: KioskPalette.inkSoft,
                  fontSize: 16,
                ),
              ),
              const SizedBox(height: 22),
              Wrap(
                spacing: 12,
                children: [
                  OutlinedButton(
                    onPressed: onRetry,
                    child: const Text('Retry'),
                  ),
                  if (unregistered)
                    FilledButton(
                      onPressed: onSetUpAgain,
                      child: const Text('Set up again'),
                    ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
