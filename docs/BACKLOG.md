# Ertelenen işler ve öneriler

Zamanı gelince yapılacak işler. Yapılan madde bu listeden silinir.

## Sprint 4 (moderasyon ve rate limit)
- [ ] `POST /api/guest` için IP başına hız sınırı ekle. Şu an sınırsız kullanıcı oluşturulabiliyor. Web proxy üzerinden geldiği için gerçek istemci IP'si güvenilir biçimde iletilmeli.
- [ ] `POST /api/me/*` uçlarını da aynı rate limit altyapısına al.
- [ ] SPEC §15 socket limitlerini ekle (`queue:join` 10/dk dahil).

## Sprint 5 (avatar ve hesap)
- [ ] `scripts/optimize-avatars.ts` yazılınca ham görselleri üret. Görseller gelene kadar yedek emoji gösteriliyor ve tarayıcıda 404 kaydı oluşuyor.

## Sprint 6 (lansman öncesi zorunlu)
- [ ] Kullanım Koşulları, Gizlilik ve KVKK sayfalarının gerçek metinlerini yaz; **yayından önce hukukçu onayı al.**
- [ ] 5651 log saklama süresi ve kapsamını hukukçuyla netleştir (SPEC §15 [KARAR]).
- [ ] Realtime için `pnpm build` sonrası Railway başlangıcına `prisma migrate deploy` ekle.
- [ ] Vercel'de `NEXT_PUBLIC_REALTIME_URL` ve `REALTIME_INTERNAL_URL`, Railway'de `WEB_ORIGIN` değerlerini ayarla.
- [ ] Railway'de `TRUST_PROXY=true` ayarla. Ayarlanmazsa herkes proxy IP'siyle görünür ve **kimse eşleşemez.** `MATCH_ALLOW_SAME_IP` production'da kapalı kalmalı.
- [ ] GitHub Actions ile PR'larda lint, typecheck ve test çalıştır (Redis servisiyle).
- [ ] Playwright e2e testlerini repoya ekle. Şu an tarayıcı denemeleri repo dışında elle çalıştırılıyor.

## Ürün kararları
- [ ] Aynı IP engelini gözden geçir: Türkiye'de mobil operatörler CGNAT kullandığı için farklı kişiler aynı IP'yi paylaşabilir ve eşleşemeyebilir. Öneri: FingerprintJS cihaz hash'i eklenince engeli yalnızca cihaz hash'ine dayandır, IP'yi ban/rapor sinyali olarak tut.
- [ ] Cihaz parmak izi (SPEC §4) henüz toplanmıyor; `deviceHash` boş olduğu için aynı cihaz kontrolü şimdilik yalnızca IP ile çalışıyor.
- [ ] Slogan geçici: "Yabancıyla buz, bir oyunda kırılır." Nihai metni belirle.
- [ ] Çalışma adı yerine nihai ürün adı ve logoyu belirle.

## Bakım
- [ ] ESLint 9 kullanımdan kalkıyor; uygun bir zamanda ESLint 10'a geç.
- [ ] Prisma 6'dan yeni major sürüme geçişi değerlendir.
