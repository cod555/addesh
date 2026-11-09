// Interface text for the scanner, in English and Arabic.

const STRINGS = {
  en: {
    tagline: 'Point the camera at a banknote. Hear how much it is.',
    modelLoading: 'Loading the model… {pct}',
    modelReady: 'Model ready with {n} classes',
    modelDemo: 'Demo model: orange, green and blue objects stand in for notes',
    modelMissing: 'No model yet. Add one in Settings.',
    modelFailed: 'The model didn’t load. Open Settings for details.',
    labLink: 'Model Lab for testing',
    pointCamera: 'Point the camera at a banknote',
    holdSteady: 'Hold steady',
    tapRepeat: 'Tap anywhere to hear it again',
    startingCamera: 'Starting the camera…',
    loadingModel: 'Loading the model…',
    aSettings: 'Settings',
    aLanguage: 'العربية',
    aVoiceOn: 'Voice on',
    aVoiceOff: 'Voice off',
    aTorch: 'Flashlight',
    aSwitchCam: 'Switch camera',
    aRepeat: 'Tap to hear the result. Double tap for the flashlight. Press and hold to change the language.',
    settingsTitle: 'Settings',
    sectionModel: 'Model',
    modelLinkLabel: 'Teachable Machine link',
    loadLink: 'Load link',
    useBuiltIn: 'Use the built-in model',
    sectionRecognition: 'Recognition',
    threshold: 'Confidence needed',
    hold: 'Hold time',
    mirror: 'Also check the mirrored image',
    sectionFeedback: 'Feedback',
    speak: 'Speak the value',
    feedback: 'Chime and vibration',
    bars: 'Show live confidence',
    openLab: 'Open the Model Lab',
    privacy: 'Everything runs on this device. Camera images are never uploaded.',
    close: 'Close',
    sReady: 'Ready. Point the camera at a banknote.',
    sWelcome: 'Addesh is ready. Hold a banknote in front of the phone camera. Tap the screen to hear the result again. Double tap for the flashlight. Press and hold the screen to change the language.',
    sNotUnderstood: 'Sorry, I did not understand. The language stays the same.',
    sDarkTorch: 'It is too dark. Double tap the screen to turn on the flashlight.',
    sDarkNoTorch: 'It is too dark. Move closer to a light.',
    sTorchOn: 'Flashlight on.',
    sTorchOff: 'Flashlight off.',
    sNoTorch: 'This phone does not allow the flashlight here. Move closer to a light.',
    sPoint: 'No banknote yet. Point the camera at a banknote.',
    sGone: 'No banknote.',
    changeLanguage: 'Change language',
    eInsecureT: 'The camera needs a secure link',
    eInsecureM: 'Open this app from an https:// address, such as your Vercel link, or from localhost.',
    eDeniedT: 'Camera access is blocked',
    eDeniedM: 'Allow the camera for this site in your browser’s site settings, then tap Try again.',
    eNoCamT: 'No camera found',
    eNoCamM: 'Connect a camera, or open this app on your phone.',
    eBusyT: 'The camera is in use',
    eBusyM: 'Close other apps that are using the camera, then tap Try again.',
    eNoModelT: 'No model yet',
    eNoModelM: 'Copy model.json, metadata.json and weights.bin into the model folder, or paste your Teachable Machine link in Settings.',
    eModelT: 'The model didn’t load',
    tryAgain: 'Try again',
    openSettings: 'Open Settings',
    noArabicVoice: 'This device has no Arabic voice, so results are spoken in English.',
    torchFailed: 'This camera has no flashlight control.',
    modelSwitched: 'Model loaded with {n} classes',
    statusLoaded: '{n} classes from {src}',
    modelFolder: 'the model folder',
  },
  ar: {
    tagline: 'وجّه الكاميرا نحو ورقة نقدية واسمع قيمتها.',
    modelLoading: 'جارٍ تحميل النموذج… {pct}',
    modelReady: 'النموذج جاهز. عدد الفئات: {n}',
    modelDemo: 'نموذج تجريبي: الأشياء البرتقالية والخضراء والزرقاء بدل الأوراق النقدية',
    modelMissing: 'لا يوجد نموذج بعد. أضِفه من الإعدادات.',
    modelFailed: 'تعذّر تحميل النموذج. افتح الإعدادات للتفاصيل.',
    labLink: 'مختبر النموذج للاختبار',
    pointCamera: 'وجّه الكاميرا نحو ورقة نقدية',
    holdSteady: 'ثبّت الكاميرا',
    tapRepeat: 'اضغط في أي مكان لسماعها مجددًا',
    startingCamera: 'جارٍ تشغيل الكاميرا…',
    loadingModel: 'جارٍ تحميل النموذج…',
    aSettings: 'الإعدادات',
    aLanguage: 'English',
    aVoiceOn: 'الصوت مفعّل',
    aVoiceOff: 'الصوت متوقف',
    aTorch: 'الكشاف',
    aSwitchCam: 'تبديل الكاميرا',
    aRepeat: 'اضغط لسماع النتيجة. اضغط مرتين للضوء. اضغط مطوّلًا لتغيير اللغة.',
    settingsTitle: 'الإعدادات',
    sectionModel: 'النموذج',
    modelLinkLabel: 'رابط Teachable Machine',
    loadLink: 'تحميل الرابط',
    useBuiltIn: 'استخدام النموذج المدمج',
    sectionRecognition: 'التعرّف',
    threshold: 'الثقة المطلوبة',
    hold: 'مدة الثبات',
    mirror: 'فحص الصورة المعكوسة أيضًا',
    sectionFeedback: 'التنبيهات',
    speak: 'نطق القيمة',
    feedback: 'نغمة واهتزاز',
    bars: 'إظهار نسب الثقة',
    openLab: 'فتح مختبر النموذج',
    privacy: 'كل شيء يعمل على هذا الجهاز، ولا تُرفع صور الكاميرا أبدًا.',
    close: 'إغلاق',
    sReady: 'جاهز. وجّه الكاميرا نحو ورقة نقدية.',
    sWelcome: 'قدّيش جاهز. ضع الورقة النقدية أمام كاميرا الهاتف. اضغط على الشاشة لسماع النتيجة مرة أخرى، واضغط مرتين لتشغيل الضوء. اضغط مطوّلًا على الشاشة لتغيير اللغة.',
    sNotUnderstood: 'لم أفهم. تبقى اللغة كما هي.',
    sDarkTorch: 'المكان مظلم. اضغط مرتين على الشاشة لتشغيل الضوء.',
    sDarkNoTorch: 'المكان مظلم. اقترب من مصدر ضوء.',
    sTorchOn: 'تم تشغيل الضوء.',
    sTorchOff: 'تم إطفاء الضوء.',
    sNoTorch: 'هذا الهاتف لا يسمح بتشغيل الضوء هنا. اقترب من مصدر ضوء.',
    sPoint: 'لا توجد ورقة نقدية بعد. وجّه الكاميرا نحو ورقة نقدية.',
    sGone: 'لا توجد ورقة نقدية.',
    changeLanguage: 'تغيير اللغة',
    eInsecureT: 'الكاميرا تحتاج إلى رابط آمن',
    eInsecureM: 'افتح التطبيق من عنوان يبدأ بـ https://‏ مثل رابط Vercel، أو من localhost.',
    eDeniedT: 'الوصول إلى الكاميرا محظور',
    eDeniedM: 'اسمح باستخدام الكاميرا لهذا الموقع من إعدادات المتصفح، ثم اضغط «حاول مجددًا».',
    eNoCamT: 'لم يتم العثور على كاميرا',
    eNoCamM: 'وصّل كاميرا، أو افتح التطبيق على هاتفك.',
    eBusyT: 'الكاميرا مستخدمة',
    eBusyM: 'أغلق التطبيقات الأخرى التي تستخدم الكاميرا، ثم اضغط «حاول مجددًا».',
    eNoModelT: 'لا يوجد نموذج بعد',
    eNoModelM: 'انسخ الملفات model.json وmetadata.json وweights.bin إلى مجلد model، أو الصق رابط Teachable Machine في الإعدادات.',
    eModelT: 'تعذّر تحميل النموذج',
    tryAgain: 'حاول مجددًا',
    openSettings: 'فتح الإعدادات',
    noArabicVoice: 'لا يوجد صوت عربي على هذا الجهاز، لذلك ستُنطق النتائج بالإنجليزية.',
    torchFailed: 'لا يمكن التحكم بالكشاف في هذه الكاميرا.',
    modelSwitched: 'تم تحميل النموذج. عدد الفئات: {n}',
    statusLoaded: 'عدد الفئات: {n} من {src}',
    modelFolder: 'مجلد النموذج',
  },
};

let lang = 'en';

export function setLang(next) {
  lang = next === 'ar' ? 'ar' : 'en';
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  applyI18n(document);
}

export const getLang = () => lang;

export function t(key, vars = {}) {
  return tl(lang, key, vars);
}

/** Same as t(), in a specific language (used when speech falls back to English). */
export function tl(language, key, vars = {}) {
  const s = STRINGS[language]?.[key] ?? STRINGS.en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
}

/** Fills elements marked with data-i18n (text), data-i18n-aria (aria-label) and data-i18n-title. */
export function applyI18n(root) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  root.querySelectorAll('[data-i18n-aria]').forEach((el) => {
    el.setAttribute('aria-label', t(el.dataset.i18nAria));
  });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.title = t(el.dataset.i18nTitle);
  });
}
