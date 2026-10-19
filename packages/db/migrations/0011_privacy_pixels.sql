-- Privacy page: no more saved checkouts, the ad pixels (with consent), how long data is kept.
-- Only when the page is still the original text: a version edited by the shop is kept.
UPDATE `pages` SET `body_fr` = 'El Fatina protège vos données conformément à la **loi 18-07** relative à la protection des personnes physiques dans le traitement des données à caractère personnel.

## Ce que nous collectons

- **Pour une commande** : nom, numéro de téléphone, wilaya, commune, adresse et votre éventuelle note.
- **Avis et messages** : ce que vous écrivez dans un avis ou via la page Contact.
- **Sécurité** : une empreinte anonymisée de votre adresse IP, pour bloquer les fausses commandes, effacée après **90 jours**.

## À quoi elles servent

- Confirmer votre commande par téléphone, la préparer et la livrer.
- Vous informer du suivi de votre colis et répondre à vos messages.
- Lutter contre les fausses commandes et les abus.

Nous ne vendons et ne louons jamais vos données.

## Qui y a accès

- Notre équipe, pour traiter votre commande.
- **ZR Express**, notre transporteur : uniquement le nom, le téléphone et l''adresse nécessaires à la livraison.
- Notre hébergeur technique (Cloudflare), qui stocke le site et ses données de façon sécurisée.

## Mesure de nos publicités (Meta, TikTok)

Si vous l''acceptez dans le petit message en bas de l''écran, la boutique charge les outils de mesure de **Meta** (Facebook, Instagram) et de **TikTok**. Ils nous disent quelles publicités amènent des visites et des commandes (page vue, produit vu, ajout au panier, commande passée et son montant). Ces sociétés peuvent traiter ces informations hors d''Algérie. Sans votre accord, rien ne leur est envoyé ; vous pouvez changer d''avis à tout moment depuis le lien « Publicités » en bas de la boutique.

## Combien de temps

- **Empreinte de sécurité (IP)** : 90 jours, puis effacée.
- **Commandes** : gardées pour le service après-vente (échanges, retours) et nos comptes. Sur votre demande, votre nom, téléphone, adresse et notes en sont effacés ; seuls restent les articles, montants et la wilaya, sans lien avec vous.

## Sur votre téléphone

Votre panier, vos favoris et vos préférences (langue, mode sombre) sont enregistrés **sur votre propre téléphone**, pas chez nous. Les notifications (retour en stock, nouveautés) ne sont envoyées que si vous les acceptez, et vous pouvez les couper à tout moment.

## Vos droits

Vous pouvez demander à **consulter, corriger ou supprimer** vos données en nous écrivant depuis la page [Contact](/fr/contact).', `body_ar` = 'تحمي El Fatina معطياتك وفقًا **للقانون 18-07** المتعلق بحماية الأشخاص الطبيعيين في مجال معالجة المعطيات ذات الطابع الشخصي.

## ما الذي نجمعه

- **عند الطلب**: الاسم، رقم الهاتف، الولاية، البلدية، العنوان وملاحظتك إن وُجدت.
- **الآراء والرسائل**: ما تكتبينه في رأي أو عبر صفحة التواصل.
- **الأمان**: بصمة مجهولة لعنوان IP الخاص بك لمنع الطلبات الوهمية، تُحذف بعد **90 يومًا**.

## لماذا نستعملها

- لتأكيد طلبك عبر الهاتف وتحضيره وتوصيله.
- لإعلامك بتتبع طردك والرد على رسائلك.
- لمحاربة الطلبات الوهمية والاستعمال المسيء.

لا نبيع معطياتك ولا نؤجرها أبدًا.

## من يطّلع عليها

- فريقنا، لمعالجة طلبك.
- **ZR Express**، شركة التوصيل: فقط الاسم والهاتف والعنوان اللازمة للتوصيل.
- مزود الاستضافة التقني (Cloudflare)، الذي يحفظ الموقع ومعطياته بشكل آمن.

## قياس إعلاناتنا (Meta، TikTok)

إذا وافقتِ في الرسالة الصغيرة أسفل الشاشة، يحمّل المتجر أدوات القياس من **Meta** (فيسبوك، إنستغرام) و**TikTok**. تخبرنا أي إعلان يجلب الزيارات والطلبات (صفحة شوهدت، منتج شوهد، إضافة إلى السلة، طلب ومبلغه). قد تعالج هذه الشركات هذه المعلومات خارج الجزائر. بدون موافقتك لا يُرسل لها أي شيء، ويمكنك تغيير رأيك في أي وقت من رابط «الإعلانات» أسفل المتجر.

## مدة الحفظ

- **البصمة الأمنية (IP)**: 90 يومًا ثم تُمسح.
- **الطلبات**: تُحفظ لخدمة ما بعد البيع (الاستبدال، الإرجاع) ولحساباتنا. عند طلبك، يُمسح منها اسمك وهاتفك وعنوانك وملاحظاتك؛ تبقى فقط القطع والمبالغ والولاية، دون أي ربط بك.

## على هاتفك

سلتك ومفضلتك وتفضيلاتك (اللغة، الوضع الداكن) محفوظة **على هاتفك أنتِ**، وليس عندنا. الإشعارات (عودة قطعة إلى المخزون، الجديد) لا تُرسل إلا إذا وافقتِ عليها، ويمكنك إيقافها في أي وقت.

## حقوقك

يمكنك طلب **الاطلاع على معطياتك أو تصحيحها أو حذفها** بمراسلتنا من صفحة [تواصلي معنا](/contact).', `updated_at` = (unixepoch() * 1000)
 WHERE `slug` = 'confidentialite' AND `body_fr` = 'El Fatina protège vos données conformément à la **loi 18-07** relative à la protection des personnes physiques dans le traitement des données à caractère personnel.

## Ce que nous collectons

- **Pour une commande** : nom, numéro de téléphone, wilaya, commune, adresse et votre éventuelle note.
- **Commande non terminée** : si vous saisissez votre numéro au moment de commander sans finaliser, nous le gardons **30 jours** pour pouvoir vous recontacter, puis il est supprimé.
- **Avis et messages** : ce que vous écrivez dans un avis ou via la page Contact.
- **Sécurité** : une empreinte anonymisée de votre adresse IP, pour bloquer les fausses commandes, effacée après **90 jours**.

## À quoi elles servent

- Confirmer votre commande par téléphone, la préparer et la livrer.
- Vous informer du suivi de votre colis et répondre à vos messages.
- Lutter contre les fausses commandes et les abus.

Nous ne vendons et ne louons jamais vos données.

## Qui y a accès

- Notre équipe, pour traiter votre commande.
- **ZR Express**, notre transporteur : uniquement le nom, le téléphone et l''adresse nécessaires à la livraison.
- Notre hébergeur technique (Cloudflare), qui stocke le site et ses données de façon sécurisée.

## Sur votre téléphone

Votre panier, vos favoris et vos préférences (langue, mode sombre) sont enregistrés **sur votre propre téléphone**, pas chez nous. Les notifications (retour en stock, nouveautés) ne sont envoyées que si vous les acceptez, et vous pouvez les couper à tout moment.

## Vos droits

Vous pouvez demander à **consulter, corriger ou supprimer** vos données en nous écrivant depuis la page [Contact](/fr/contact).';
