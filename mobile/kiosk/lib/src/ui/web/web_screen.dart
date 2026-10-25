import 'dart:async';

import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';

import '../theme.dart';

/// Thin WebView wrapper around a single configured URL — the "web screen"
/// role, for join/track-style pages that stay dynamic on the server rather
/// than being reimplemented natively (see docs/flutter-kiosk-plan.md §1b).
/// Not a browser: no address bar, no navigation chrome, one URL for the
/// life of the device.
class WebScreen extends StatefulWidget {
  const WebScreen({super.key, required this.url});

  final String url;

  @override
  State<WebScreen> createState() => _WebScreenState();
}

class _WebScreenState extends State<WebScreen> {
  late final WebViewController _controller;
  bool _loadFailed = false;
  Timer? _retryTimer;

  @override
  void initState() {
    super.initState();
    _controller = _buildController();
  }

  WebViewController _buildController() {
    late final PlatformWebViewControllerCreationParams params;
    final platform = WebViewPlatform.instance;
    if (platform is AndroidWebViewPlatform) {
      params = AndroidWebViewControllerCreationParams();
    } else {
      params = const PlatformWebViewControllerCreationParams();
    }

    final controller = WebViewController.fromPlatformCreationParams(params);
    if (controller.platform is AndroidWebViewController) {
      // Waiting-room/kiosk hardware never gets a user gesture to unlock
      // autoplay — this is the same fix the plan doc specifies for the
      // display board's audio.
      (controller.platform as AndroidWebViewController)
          .setMediaPlaybackRequiresUserGesture(false);
    }

    controller
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(KioskPalette.bg)
      ..setNavigationDelegate(NavigationDelegate(
        onPageStarted: (_) {
          if (mounted) setState(() => _loadFailed = false);
        },
        onWebResourceError: (error) {
          // Only treat a failed *main-frame* navigation as a page failure —
          // a blocked tracking pixel or a missing sub-resource must not
          // blank the whole screen.
          if (error.isForMainFrame ?? true) {
            if (mounted) setState(() => _loadFailed = true);
            _scheduleRetry();
          }
        },
      ))
      ..loadRequest(Uri.parse(widget.url));

    return controller;
  }

  @override
  void didUpdateWidget(WebScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    // The controller is built once, so switching service from Settings (e.g.
    // Order counter → Kitchen) reuses this State with a new url — load it, or
    // the old counter stays on screen.
    if (oldWidget.url != widget.url) {
      _retryTimer?.cancel();
      _controller.loadRequest(Uri.parse(widget.url));
    }
  }

  void _scheduleRetry() {
    _retryTimer?.cancel();
    _retryTimer = Timer(const Duration(seconds: 5), () {
      if (mounted) _controller.reload();
    });
  }

  @override
  void dispose() {
    _retryTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: KioskPalette.bg,
      body: Stack(
        children: [
          WebViewWidget(controller: _controller),
          if (_loadFailed)
            Container(
              color: KioskPalette.bg,
              alignment: Alignment.center,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.wifi_off_rounded, size: 40, color: KioskPalette.inkFaint),
                  const SizedBox(height: 12),
                  const Text('Reconnecting…', style: TextStyle(color: KioskPalette.inkSoft)),
                ],
              ),
            ),
        ],
      ),
    );
  }
}
