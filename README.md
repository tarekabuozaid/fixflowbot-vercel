# FixFlowBot on Vercel (Telegraf)

## الخطوات السريعة
1) أنشئ مشروع على Vercel من هذا الريبو (أو Import من GitHub).
2) في **Project → Settings → Environment Variables**:
   - `BOT_TOKEN` = التوكن من BotFather
   - `PUBLIC_URL` = رابط مشروعك على Vercel (مثال: https://fixflowbot.vercel.app)
3) **Deploy**.
4) محليًا (أو من أي بيئة فيها Node 18+):
   ```bash
   npm run set:webhook
   npm run diag
   ```
   تأكد إن `getWebhookInfo.result.url` يساوي:
   `https://YOUR-APP.vercel.app/api/telegram`
5) افتح البوت وابعت: `/ping` → لازم يرد `pong`.

## أوامر موجودة

* `/start` → Bot ready
* `/ping` → pong
* أي نص → Echo

## حذف الويبهوك

```bash
npm run del:webhook
```

## ملاحظات

* الردود سريعة بدون Cold Start زي GAS.
* تقدر تضيف أوامر/منطق FixFlow هنا بسهولة.
* لو عايز Multi-tenants لاحقًا: اعمل Route ديناميكي مثل `api/telegram/[tenant].js` وخريطة ENV لكل عميل.

### تشغيل سريع (مختصر)
- على Vercel: ضيف `BOT_TOKEN` و `PUBLIC_URL` في Environment → **Deploy**.
- على جهازك: شغّل `npm run set:webhook` ثم `npm run diag`.
- في تيليجرام: `/ping` → هتشوف `pong`.

لو عايز الإصدار **Multi-tenant** (كل عميل سلاج مميز)، قول وأنا أجهزه بنفس الأسلوب في بلوك Cursor تاني.
