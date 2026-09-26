/// Guest-facing strings for the hotel / restaurant kiosk and board. One flat
/// table per locale instead of a field per string: the hotel product grows new
/// screens, and a missing key must fall back to English rather than fail the
/// build. Kept separate from [KioskCopy] (school) and [HospitalCopy].
class BusinessCopy {
  const BusinessCopy._(this.locale);

  final String locale;

  static const supported = ['en', 'ar', 'mr', 'hi'];

  /// A locale's own name, for the language chips — never translated, so a guest
  /// who can't read the current language can still find theirs.
  static const nativeNames = {
    'en': 'English',
    'ar': 'العربية',
    'mr': 'मराठी',
    'hi': 'हिन्दी',
  };

  static BusinessCopy of(String locale) =>
      BusinessCopy._(_strings.containsKey(locale) ? locale : 'en');

  bool get isRtl => locale == 'ar';

  String _t(String key) =>
      _strings[locale]?[key] ?? _strings['en']![key] ?? key;

  // ── Kiosk ──────────────────────────────────────────────────
  String get welcome => _t('welcome');
  String get prompt => _t('prompt');
  String get promptHint => _t('promptHint');
  String get getNumber => _t('getNumber');
  String get issuing => _t('issuing');
  String get yourNumber => _t('yourNumber');
  String get bill => _t('bill');
  String get keepTicket => _t('keepTicket');
  String get clear => _t('clear');
  String get done => _t('done');
  String get selfJoinOff => _t('selfJoinOff');
  String get offline => _t('offline');
  String get paused => _t('paused');
  String get printFailed => _t('printFailed');
  String get step1 => _t('step1');
  String get step2 => _t('step2');
  String get step3 => _t('step3');

  /// How many guests are in front of this one.
  String ahead(int n) {
    if (n <= 0) return _t('aheadZero');
    if (n == 1) return _t('aheadOne');
    return _t('aheadMany').replaceAll('{n}', '$n');
  }

  // ── Board ──────────────────────────────────────────────────
  String get nowServing => _t('nowServing');
  String get nowCalling => _t('nowCalling');
  String get proceed => _t('proceed');
  String get nextUp => _t('nextUp');
  String get waiting => _t('waiting');
  String get waitingForNext => _t('waitingForNext');
  String get noneWaiting => _t('noneWaiting');
}

const _strings = <String, Map<String, String>>{
  'en': {
    'step1': 'Type the number from your bill',
    'step2': 'Take your printed ticket',
    'step3': 'Watch the screen for your number',
    'welcome': 'Welcome',
    'prompt': 'Enter your bill number',
    'promptHint': 'The number printed on your bill or order slip',
    'getNumber': 'Get my number',
    'issuing': 'Getting your number…',
    'yourNumber': 'Your queue number',
    'bill': 'Bill',
    'aheadZero': 'You are next in line',
    'aheadOne': '1 guest ahead of you',
    'aheadMany': '{n} guests ahead of you',
    'keepTicket': 'Take your ticket and watch the screen for your number.',
    'clear': 'Clear',
    'done': 'Done',
    'selfJoinOff': 'Please see the counter staff to get your number.',
    'offline': "Can't reach the server. Retrying…",
    'paused': 'The queue is paused for a moment',
    'printFailed': "Couldn't print — please note your number.",
    'nowServing': 'Now serving',
    'nowCalling': 'Now calling',
    'proceed': 'Please proceed to the counter',
    'nextUp': 'Next up',
    'waiting': 'waiting',
    'waitingForNext': 'Waiting for the next guest',
    'noneWaiting': 'No one is waiting',
  },
  'ar': {
    'step1': 'اكتب الرقم المطبوع على فاتورتك',
    'step2': 'خذ تذكرتك المطبوعة',
    'step3': 'تابع الشاشة حتى يُنادى رقمك',
    'welcome': 'أهلاً بك',
    'prompt': 'أدخل رقم فاتورتك',
    'promptHint': 'الرقم المطبوع على فاتورتك أو إيصال الطلب',
    'getNumber': 'احصل على رقمي',
    'issuing': 'جارٍ إصدار رقمك…',
    'yourNumber': 'رقمك في الطابور',
    'bill': 'فاتورة',
    'aheadZero': 'أنت التالي في الطابور',
    'aheadOne': 'شخص واحد قبلك',
    'aheadMany': 'عدد المنتظرين قبلك: {n}',
    'keepTicket': 'خذ تذكرتك وتابع الشاشة حتى يُنادى رقمك.',
    'clear': 'مسح',
    'done': 'تم',
    'selfJoinOff': 'يرجى مراجعة موظف المنضدة للحصول على رقمك.',
    'offline': 'تعذّر الاتصال بالخادم. جارٍ إعادة المحاولة…',
    'paused': 'الطابور متوقف مؤقتاً',
    'printFailed': 'تعذّرت الطباعة — يرجى تدوين رقمك.',
    'nowServing': 'يتم الخدمة الآن',
    'nowCalling': 'جاري النداء',
    'proceed': 'يرجى التوجه إلى المنضدة',
    'nextUp': 'التالي',
    'waiting': 'بالانتظار',
    'waitingForNext': 'في انتظار الضيف التالي',
    'noneWaiting': 'لا أحد في الانتظار',
  },
  'hi': {
    'step1': 'अपने बिल का नंबर टाइप करें',
    'step2': 'अपना छपा टिकट लें',
    'step3': 'अपने नंबर के लिए स्क्रीन देखें',
    'welcome': 'स्वागत है',
    'prompt': 'अपना बिल नंबर दर्ज करें',
    'promptHint': 'आपके बिल या ऑर्डर पर्ची पर छपा नंबर',
    'getNumber': 'मेरा नंबर पाएँ',
    'issuing': 'आपका नंबर निकाला जा रहा है…',
    'yourNumber': 'आपका क्रम नंबर',
    'bill': 'बिल',
    'aheadZero': 'अगला नंबर आपका है',
    'aheadOne': 'आपसे पहले 1 व्यक्ति',
    'aheadMany': 'आपसे पहले {n} लोग',
    'keepTicket': 'अपना टिकट लें और अपने नंबर के लिए स्क्रीन देखते रहें।',
    'clear': 'मिटाएँ',
    'done': 'हो गया',
    'selfJoinOff': 'कृपया नंबर के लिए काउंटर स्टाफ से मिलें।',
    'offline': 'सर्वर से संपर्क नहीं हो पा रहा। दोबारा कोशिश जारी…',
    'paused': 'कतार कुछ देर के लिए रुकी है',
    'printFailed': 'प्रिंट नहीं हो सका — कृपया अपना नंबर नोट कर लें।',
    'nowServing': 'अभी सेवा में',
    'nowCalling': 'अभी बुलाया जा रहा है',
    'proceed': 'कृपया काउंटर पर आएँ',
    'nextUp': 'अगले',
    'waiting': 'प्रतीक्षा में',
    'waitingForNext': 'अगले ग्राहक की प्रतीक्षा',
    'noneWaiting': 'कोई प्रतीक्षा में नहीं है',
  },
  'mr': {
    'step1': 'तुमच्या बिलावरील नंबर टाका',
    'step2': 'तुमचे छापलेले तिकीट घ्या',
    'step3': 'तुमच्या नंबरसाठी स्क्रीन पाहा',
    'welcome': 'स्वागत आहे',
    'prompt': 'तुमचा बिल क्रमांक टाका',
    'promptHint': 'तुमच्या बिलावर किंवा ऑर्डर स्लिपवर छापलेला क्रमांक',
    'getNumber': 'माझा नंबर मिळवा',
    'issuing': 'तुमचा नंबर काढत आहोत…',
    'yourNumber': 'तुमचा रांगेतील नंबर',
    'bill': 'बिल',
    'aheadZero': 'पुढचा नंबर तुमचा आहे',
    'aheadOne': 'तुमच्या आधी १ व्यक्ती',
    'aheadMany': 'तुमच्या आधी {n} लोक',
    'keepTicket':
        'तुमचे तिकीट घ्या आणि नंबर पुकारेपर्यंत स्क्रीनकडे लक्ष ठेवा.',
    'clear': 'पुसा',
    'done': 'झाले',
    'selfJoinOff': 'नंबरसाठी कृपया काउंटरवरील कर्मचाऱ्यांना भेटा.',
    'offline': 'सर्व्हरशी संपर्क होत नाही. पुन्हा प्रयत्न सुरू…',
    'paused': 'रांग काही वेळासाठी थांबली आहे',
    'printFailed': 'प्रिंट झाले नाही — कृपया तुमचा नंबर लिहून ठेवा.',
    'nowServing': 'सध्या सेवेत',
    'nowCalling': 'आता पुकारत आहोत',
    'proceed': 'कृपया काउंटरकडे या',
    'nextUp': 'पुढचे',
    'waiting': 'प्रतीक्षेत',
    'waitingForNext': 'पुढच्या ग्राहकाची प्रतीक्षा',
    'noneWaiting': 'कोणीही प्रतीक्षेत नाही',
  },
};
