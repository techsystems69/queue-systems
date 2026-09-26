import 'package:flutter/foundation.dart';
import 'package:flutter_tts/flutter_tts.dart';

import '../models/business/business_board_packet.dart';

/// Speaks a digit run one digit at a time once it reaches three digits — the
/// same rule as `formatForSpeech` in components/display/TVDisplay.tsx. A TTS
/// engine reads "5397845" as "five million…", which is slow and easy to
/// mishear across a dining room; "5, 3, 9, 7, 8, 4, 5" is not. One and two
/// digit numbers stay whole ("12" → "twelve").
String spellNumber(int value) {
  final s = '$value';
  return s.length >= 3 ? s.split('').join(', ') : s;
}

/// `en` → English only; `ar` → Arabic only; `both` → English then Arabic.
List<String> announceLocales(String announcementLang) => switch (announcementLang) {
      'ar' => const ['ar'],
      'both' => const ['en', 'ar'],
      _ => const ['en'],
    };

String _text(String locale, int number) {
  final spoken = spellNumber(number);
  return locale == 'ar'
      ? 'رقم التذكرة $spoken، يرجى التوجه إلى المنضدة.'
      : 'Token number $spoken, please proceed to the counter.';
}

const _voice = {'en': 'en-IN', 'ar': 'ar-SA'};

/// Native TTS announcer for the hotel board. Speaks through the OS engine, so —
/// unlike the web board — there is no "tap to enable sound" step.
class BusinessAnnouncer {
  BusinessAnnouncer() : _tts = FlutterTts() {
    _tts.awaitSpeakCompletion(true);
  }

  final FlutterTts _tts;
  List<String>? _installed;
  Future<void> _queue = Future.value();

  /// True while a call is being spoken — the ad rail ducks video audio.
  final ValueNotifier<bool> isSpeaking = ValueNotifier(false);

  Future<bool> _hasVoice(String bcp47) async {
    if (_installed == null) {
      try {
        final langs = await _tts.getLanguages;
        _installed =
            (langs as List?)?.map((l) => '$l'.toLowerCase()).toList() ?? const [];
      } catch (_) {
        _installed = const [];
      }
    }
    final prefix = bcp47.split('-').first;
    return _installed!.any((l) => l == bcp47.toLowerCase() || l.startsWith(prefix));
  }

  /// Announce one call. Calls are queued so two in quick succession are spoken
  /// one after the other instead of cutting each other off.
  Future<void> announceCall({
    required int queueNumber,
    required String announcementLang,
  }) {
    _queue = _queue.then((_) => _speak(queueNumber, announcementLang));
    return _queue;
  }

  Future<void> _speak(int number, String lang) async {
    isSpeaking.value = true;
    try {
      for (final locale in announceLocales(lang)) {
        // No Arabic voice installed → say it in English rather than stay silent.
        final target = _voice[locale]!;
        final hasVoice = await _hasVoice(target);
        final useLocale = hasVoice ? locale : 'en';
        try {
          await _tts.setLanguage(_voice[useLocale]!);
          await _tts.setSpeechRate(0.45);
          await _tts.speak(_text(useLocale, number));
        } catch (e) {
          debugPrint('[BusinessAnnouncer] speak failed: $e');
        }
      }
    } finally {
      isSpeaking.value = false;
    }
  }

  Future<void> dispose() async {
    try {
      await _tts.stop();
    } catch (_) {}
  }
}

/// Tracks which calls have been announced so a 3-second poll doesn't re-speak
/// the same one every tick. The first packet after (re)connect announces
/// nothing: a board that just came up must not shout a call that was made
/// minutes ago.
class BusinessAnnouncementDedupe {
  String? _lastKey;
  bool _primed = false;

  /// The call to announce now, or null. Between calls (nobody in progress) the
  /// key resets, so the *same* guest called again later still announces.
  BusinessServing? newCall(BusinessServing? serving) {
    if (serving == null) {
      _lastKey = null;
      _primed = true;
      return null;
    }
    final key = serving.callKey;
    final fresh = _primed && key != _lastKey;
    _lastKey = key;
    _primed = true;
    return fresh ? serving : null;
  }
}
