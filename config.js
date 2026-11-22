// ============================================================
// إعدادات منصة "سجّل واكسب"
// الباك إند على نفس مشروع Supabase بتاع منصة "الشغل الفوري"
// (مشروع shoghl-fawry — ref: xqtmtbvhtenwlnsipdsq)،
// بس بدالة منفصلة اسمها rewards وجداول منفصلة ببادئة rw_،
// عشان متلمسش أي حاجة من المنصة الحالية.
// ملاحظة أمان: الواجهة بتكلم الـ Edge Function بس، والـ Edge Function
// هي اللي معاها مفتاح service-role (كـ secret على السيرفر).
// مفيش أي مفتاح service-role في المجلد ده إطلاقًا.
// ============================================================
window.SW_CONFIG = {
  API_BASE: "https://xqtmtbvhtenwlnsipdsq.supabase.co/functions/v1/rewards"
};
