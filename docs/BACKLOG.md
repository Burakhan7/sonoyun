# Ertelenen işler ve öneriler

Zamanı gelince yapılacak işler. Yapılan madde bu listeden silinir.

## Sprint 5 (avatar ve hesap)
- [ ] Engelleme akışına arkadaşlık, bekleyen istek ve DM gizleme temizliğini ekle (SPEC §10).
- [ ] Sohbet sonrası paneldeki "Arkadaş ekle" butonunu etkinleştir.
- [ ] `scripts/optimize-avatars.ts` yazılınca ham görselleri üret. Görseller gelene kadar yedek emoji gösteriliyor ve tarayıcıda 404 kaydı oluşuyor.

- [ ] Gemini ile 24 avatar görselini üret ve `apps/web/public/avatars/raw/{id}.png` olarak ekle (`docs/GEMINI_AVATARS.md`).

## Sprint 6 (lansman öncesi zorunlu)
- [ ] `/admin` paneli: açık raporlar, snapshot görüntüleme, ban/unban. "Reşit olmadığını düşünüyorum" raporları öncelikli listelensin; otomatik 24 saat eşleşme kısıtı buradan kaldırılabilsin.
- [ ] `AccessLog` kayıtları (5651): bağlantı, eşleşme ve mesaj olaylarında IP + port + zaman damgası.
- [ ] Çerez bandı, analitik (PostHog/Plausible) ve Ayarlar → "Hesabımı sil".
- [ ] Sentry (web + realtime), realtime Dockerfile, Railway/Vercel kurulum notları ve README lansman kontrol listesi.
- [ ] k6 yük testi: 500 eşzamanlı socket ile eşleşme + oyun + sohbet.
- [ ] `/health` yalnızca sürecin ayakta olduğunu söylüyor. Redis ve Postgres durumunu da gösteren bir hazır olma (readiness) kontrolü ekle.
- [ ] Realtime yeniden başlarsa bellekteki canlı oyunlar kaybolur ve oyuncular "oyun sona erdi" görür. Deploy sırasında bunu azaltacak kademeli kapanış planla.
- [ ] Kullanım Koşulları, Gizlilik ve KVKK sayfalarının gerçek metinlerini yaz; **yayından önce hukukçu onayı al.**
- [ ] 5651 log saklama süresi ve kapsamını hukukçuyla netleştir (SPEC §15 [KARAR]).
- [ ] Realtime için `pnpm build` sonrası Railway başlangıcına `prisma migrate deploy` ekle.
- [ ] Vercel'de `NEXT_PUBLIC_REALTIME_URL` ve `REALTIME_INTERNAL_URL`, Railway'de `WEB_ORIGIN` değerlerini ayarla.
- [ ] `apps/realtime/badwords.tr.txt` kelime listesini doldur. **Liste boşken küfür maskeleme çalışmaz.**
- [ ] Vercel ve Railway'de aynı `INTERNAL_API_SECRET` değerini ayarla (en az 32 karakter). Realtime production'da bu değer olmadan başlamaz.
- [ ] Railway'de `TRUST_PROXY=true` ayarla. Ayarlanmazsa herkes proxy IP'siyle görünür ve **kimse eşleşemez.** `MATCH_ALLOW_SAME_IP` production'da kapalı kalmalı.
- [ ] Oyun durumu realtime sürecinin belleğinde. Birden fazla instance'a çıkmadan önce sticky session ekle; aksi halde yeniden bağlanan oyuncu oyununa dönemez. Lansmanda tek instance çalıştır.
- [ ] GitHub Actions ile PR'larda lint, typecheck ve test çalıştır (Redis servisiyle).
- [ ] Playwright e2e testlerini repoya ekle. Şu an tarayıcı denemeleri repo dışında elle çalıştırılıyor.

## Ürün kararları
- [ ] Aynı IP engelini gözden geçir: Türkiye'de mobil operatörler CGNAT kullandığı için farklı kişiler aynı IP'yi paylaşabilir ve eşleşemeyebilir. Öneri: FingerprintJS cihaz hash'i eklenince engeli yalnızca cihaz hash'ine dayandır, IP'yi ban/rapor sinyali olarak tut.
- [ ] Cihaz parmak izi (SPEC §4) henüz toplanmıyor; `deviceHash` boş olduğu için aynı cihaz kontrolü şimdilik yalnızca IP ile çalışıyor.
- [ ] Slogan geçici: "Yabancıyla buz, bir oyunda kırılır." Nihai metni belirle.
- [ ] Çalışma adı yerine nihai ürün adı ve logoyu belirle.

## Küçük iyileştirmeler
- [ ] Kart seçimi ekranında sunucudan gelen hata mesajları gösterilmiyor; `CardPicker` içine bildirim alanı ekle.
- [ ] Sohbette 1 mesaj/sn sınırına takılan kullanıcı için butonda kısa bir bekleme göstergesi ekle.
- [ ] Tarayıcı denemelerinde beraberlik dışı senaryolar için sabit test verisi kullan.

## Bakım
- [ ] ESLint 9 kullanımdan kalkıyor; uygun bir zamanda ESLint 10'a geç.
- [ ] Prisma 6'dan yeni major sürüme geçişi değerlendir.
