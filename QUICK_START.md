# 🚀 دليل البدء السريع - FixFlow Bot

## ⚡ البدء في 5 دقائق

### 1. إنشاء البوت على Telegram
1. اذهب إلى [@BotFather](https://t.me/BotFather)
2. أرسل `/newbot`
3. اتبع التعليمات لإنشاء البوت
4. احفظ `BOT_TOKEN` الذي ستحصل عليه

### 2. إعداد قاعدة البيانات
1. أنشئ قاعدة بيانات PostgreSQL (يمكنك استخدام Neon أو Supabase)
2. احفظ `DATABASE_URL`

### 3. إعداد المشروع
```bash
# استنساخ المشروع
git clone https://github.com/your-username/fixflowbot.git
cd fixflowbot

# تثبيت التبعيات
npm install

# إعداد متغيرات البيئة
cp env.example .env
# عدّل ملف .env بالمعلومات الصحيحة
```

### 4. تشغيل البوت
```bash
# إعداد قاعدة البيانات
npx prisma generate
npx prisma migrate deploy

# تشغيل البوت
npm start
```

## 🎯 الاستخدام الأساسي

### تسجيل منشأة جديدة
```
/registerfacility
```
**الخطوات:**
1. أدخل اسم المنشأة
2. اختر المدينة
3. أدخل رقم الهاتف
4. اختر الخطة (Free/Pro/Business)

### تسجيل مستخدم جديد
```
👤 Register as User
🔧 Register as Technician
👨‍💼 Register as Supervisor
```
**الخطوات:**
1. أدخل الاسم الكامل
2. البريد الإلكتروني (اختياري)
3. رقم الهاتف (اختياري)
4. المسمى الوظيفي (اختياري)
5. اختر المنشأة

### إنشاء بلاغ جديد
```
➕ Create Work Order
```
**الخطوات:**
1. اختر نوع العمل (Maintenance, Repair, etc.)
2. اختر نوع الخدمة (Electrical, Mechanical, etc.)
3. حدد الأولوية (High, Medium, Low)
4. أدخل الموقع
5. أدخل المعدات (اختياري)
6. اكتب الوصف

## 📋 الأوامر الأساسية

### أوامر إدارة المنشآت
- `/registerfacility` - تسجيل منشأة جديدة
- `/join` - الانضمام لمنشأة موجودة
- `/switch` - تبديل المنشأة النشطة

### أوامر إدارة البلاغات
- `➕ Create Work Order` - إنشاء بلاغ جديد
- `📋 My Work Orders` - عرض بلاغاتي
- `🔧 Manage Work Orders` - إدارة البلاغات

### أوامر المساعدة
- `/help` - دليل المساعدة الشامل
- `/start` - بدء استخدام البوت

## 🔧 الإعداد المتقدم

### متغيرات البيئة المطلوبة
```env
# إعدادات البوت الأساسية
BOT_TOKEN=your_telegram_bot_token
DATABASE_URL=your_postgresql_connection_string
MASTER_ID=your_telegram_user_id

# إعدادات الأمان
RATE_LIMIT=30
RATE_LIMIT_WINDOW=60000
```

### النشر على Vercel
```bash
# تثبيت Vercel CLI
npm i -g vercel

# تسجيل الدخول
vercel login

# النشر
vercel --prod

# تعيين Webhook
npm run webhook:set
```

## 🛠️ استكشاف الأخطاء

### مشاكل شائعة

#### البوت لا يستجيب
```bash
# تحقق من BOT_TOKEN
echo $BOT_TOKEN

# تحقق من قاعدة البيانات
npx prisma db pull

# تشغيل اختبارات الوحدات
node scripts/test-modules.js
```

#### خطأ في قاعدة البيانات
```bash
# إعادة إنشاء Prisma Client
npx prisma generate

# تشغيل الهجرات
npx prisma migrate dev

# فحص الاتصال
npx prisma db pull
```

#### خطأ في Webhook
```bash
# تعيين Webhook يدوياً
npm run webhook:set

# التحقق من URL
echo $PUBLIC_URL
```

### سجلات الأخطاء
```bash
# عرض سجلات Vercel
vercel logs --follow

# اختبار البوت محلياً
npm run test
```

## 📊 خطط الاشتراك

### 🆓 الخطة المجانية
- 5 أعضاء
- 50 بلاغ شهرياً
- 3 تقارير أساسية
- 10 تذكيرات

### ⭐ الخطة الاحترافية
- 20 عضو
- 200 بلاغ شهرياً
- 15 تقرير متقدم
- 50 تذكير

### 🏢 الخطة المؤسسية
- 100 عضو
- 1000 بلاغ شهرياً
- 100 تقرير شامل
- 200 تذكير

## 🎯 نصائح للاستخدام

### للمستخدمين الجدد
1. ابدأ بتسجيل منشأة جديدة
2. سجل نفسك كـ Facility Admin
3. جرب إنشاء بلاغ تجريبي
4. استكشف التقارير والتحليلات

### للمشرفين
1. استخدم `/members` لإدارة الأعضاء
2. استخدم `🔧 Manage Work Orders` لإدارة البلاغات
3. استخدم `📊 Advanced Reports` للتقارير المتقدمة
4. راقب حدود الخطة باستمرار

### للمطورين
1. اقرأ `MODULES.md` لفهم البنية الوحداتية
2. استخدم `node scripts/test-modules.js` لاختبار الوحدات
3. اتبع معايير الكود في `README.md`
4. أضف اختبارات للميزات الجديدة

## 🔗 روابط مفيدة

- [التوثيق الكامل](README.md)
- [دليل الوحدات](MODULES.md)
- [خطة التطوير](MIGRATION_PLAN.md)
- [GitHub Repository](https://github.com/your-username/fixflowbot)

## 📞 الدعم

### المساعدة الفورية
- استخدم `/help` في البوت
- راجع رسائل الترحيب للمستخدمين الجدد

### الدعم التقني
- اقرأ التوثيق الشامل
- راجع أمثلة الاستخدام
- اتبع إرشادات استكشاف الأخطاء

### المساهمة
- Fork المشروع
- أنشئ branch جديد
- أضف الميزات المطلوبة
- أنشئ Pull Request

---

**FixFlow Bot** - نظام إدارة الصيانة الذكي 🚀

*ابدأ الآن واستمتع بإدارة صيانة احترافية!*
