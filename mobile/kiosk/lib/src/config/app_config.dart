/// Compile-time / behavioural constants. Values that must match the web kiosk
/// are labelled with their source.
class AppConfig {
  AppConfig._();

  /// Prefilled in the setup screen. Set the real deployment URL per build with
  /// `--dart-define=KIOSK_BASE_URL=https://…`; the operator can still edit it.
  /// `10.0.2.2` is the Android emulator's alias for the host's localhost, handy
  /// when testing against `next dev`.
  static const String defaultBaseUrl = String.fromEnvironment(
    'KIOSK_BASE_URL',
    defaultValue: 'http://10.0.2.2:3000',
  );

  /// FEED_POLL_MS in components/school/SchoolKiosk.tsx. The rail is just
  /// recently-issued tickets and every local issue folds itself in
  /// optimistically, so a slower poll costs nothing visible while roughly
  /// halving the kiosk's serverless-invocation load on an idle terminal.
  static const Duration feedPollInterval = Duration(seconds: 20);

  /// RECENT_LIMIT in components/school/SchoolKiosk.tsx.
  static const int recentLimit = 30;

  /// How long the confirmation covers the service grid before it returns to
  /// the neutral prompt. The web kiosk shows its ticket in a side rail and can
  /// leave it up until the next tap; this one covers the grid, so the timeout
  /// is the next visitor's wait — long enough to read a number off the screen
  /// and take the paper, not long enough to queue people behind it. Anyone who
  /// is done sooner taps Done, or anywhere.
  static const Duration heroLinger = Duration(seconds: 3);

  /// Same idea as [heroLinger], but for a ticket whose confirmation also
  /// shows a trackable QR code: long enough for a visitor to actually raise
  /// their phone and scan it, with the on-screen progress bar counting the
  /// same window down so it never looks like an arbitrary wait.
  static const Duration qrLinger = Duration(seconds: 10);

  /// Backoff for the bootstrap/feed retry loop on network failure — mirrors
  /// MainActivity.kt's reload-on-error in android-kiosk/.
  static const Duration retryInterval = Duration(seconds: 5);

  /// How long a tap may sit on a spinner before the screen says what it is
  /// waiting for. Under this, a request that is merely slow explains itself by
  /// finishing; over it, a silent spinner is what makes a visitor decide the
  /// kiosk is broken and walk off without a number.
  static const Duration slowRequestHint = Duration(seconds: 3);

  /// How long the connection dialog stays up on an unattended terminal before
  /// closing itself. Nobody is there to dismiss it, and the next visitor must
  /// meet the service grid, not the last person's error.
  static const Duration errorDialogLinger = Duration(seconds: 15);
}
