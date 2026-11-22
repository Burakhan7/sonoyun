# Codex sprint istemleri

Codex'e aşağıdaki istemleri **sırayla ve tek tek** ver. Bir sprint bitip testler geçmeden sonrakine geçme. Her istem kopyala-yapıştır hazırdır.

---

## Sprint 0 — İskelet

```
docs/SPEC.md ve AGENTS.md'yi oku. SPEC §2 ve §3'e göre monorepo iskeletini kur:
- pnpm workspaces + Turborepo; apps/web (Next.js 15, App Router, Tailwind, TypeScript strict), apps/realtime (Fastify + Socket.IO + ioredis + Prisma), packages/shared.
- Yerel geliştirme için docker-compose.yml (Postgres 16, Redis 7) ve .env.example.
- ESLint, Prettier, Vitest kurulumu; kök package.json'da dev, build, lint, typecheck, test script'leri.
- SPEC §13'teki Prisma şemasını apps/realtime/prisma/schema.prisma olarak ekle ve ilk migration'ı oluştur.
- packages/shared/content/questions.json zaten repoda; onu shared paketinden tipli olarak export et (Zod şeması ile doğrula).
Bitince pnpm lint, typecheck ve test çalıştır, sonuçları raporla.
```

## Sprint 1 — Misafir kimliği, açılış, online sayacı

```
SPEC §4, §5.1 ve §12'yi uygula:
- POST /api/guest: User oluştur, rastgele avatarId (SPEC §18'deki 24 hayvan) + sıfat ile nickname üret, 365 günlük HS256 JWT dön; httpOnly çerez + localStorage.
- Socket.IO handshake'inde JWT doğrulaması, bannedUntil kontrolü.
- Açılış sayfası: logo, slogan, Oyna butonu, avatar + takma ad (günde 1 kez yenile), gerçek online sayısı, arkadaşlar ve mesajlar ikonları (şimdilik boş sayfalara gitsin).
- İlk girişte 18+ onay modali; onay acceptedTermsAt'e yazılır.
- Online sayacı: presence:online SET + bağlantı sayacı, her 5 sn online:count yayını (online, activeGames, gamesToday). Sahte veya taban değer yok.
- Avatar bileşeni: /avatars/{id}.webp, yoksa yedek emoji; her zaman daire içinde.
Testler: aynı kullanıcı iki sekmede tek sayılır; sekme kapanınca sayaç düşer.
```

## Sprint 2 — Eşleşme ve oda durum makinesi

```
SPEC §5.2, §5.3, §6 ve §14'ü uygula:
- packages/shared/events.ts: SPEC §14'teki tüm event'ler ve Zod payload şemaları.
- Redis kuyruğu (mm:queue ZSET), 500 ms'lik tick, mm:lock kilidi, son-20 listesi (mm:recent), engel seti (block:), aynı cihaz/IP kontrolü.
- Oda durum makinesi: MATCHED → SPIN → PLAYING → PICKING → CHATTING → ENDED.
- Kategori seçimi: iki oyuncunun son 3 kategorisi hariç rastgele; motor seçimi: o kategoride o tipte en az 8 içerik olan motorlar arasından rastgele.
- Web: "Rakip aranıyor" ekranı (geçen süre, iptal), 60 sn sonra "Şu an kimse yok" ekranı (davet linki, aramaya devam et, rakip gelince ses + sekme başlığı bildirimi). Kategori çarkı animasyonu (3 sn, sunucunun sonucunda durur).
Testler: son 20'deki rakiple eşleşmez; engelli çift asla eşleşmez; 21. eşleşmeden sonra tekrar eşleşebilir; aynı anda 100 kullanıcı kuyruğa girince herkes en fazla bir odaya düşer.
```

## Sprint 3 — Oyun motorları

```
SPEC §8'i uygula. apps/realtime/src/games/ altında ortak GameEngine arayüzü ve 6 motor: mc, emoji, estimate, tf, mixed, ayna.
- Tur akışı: round:start (cevapsız soru, endsAt) → game:answer (ilk cevap kilitlenir) → round:result → 2 sn → sonraki tur → game:over.
- Şıklar her gönderimde karıştırılır; doğru indeks yalnızca sunucu belleğinde.
- Puanlama SPEC §8 tablosundaki gibi; ayna motoru uyum yüzdesini de hesaplar.
- seen:{userId} ile son 200 görülen soru mümkünse tekrar gelmez.
- Bağlantı koparsa 15 sn bekleme; dönmezse rakip hükmen kazanır.
- Web: oyun ekranı (iki oyuncu, skor, tur göstergesi, dairesel sayaç, başparmak bölgesinde cevap butonları), 360 px'te düzgün.
Testler: her motor için doğru cevabın round:result'tan önce hiçbir payload'da bulunmadığını doğrulayan test; puanlama testleri; beraberlik.
```

## Sprint 4 — Kartlar, 7 dakikalık sohbet, moderasyon

```
SPEC §5.5, §5.6, §5.7, §9 ve §11'i uygula:
- Sonuç ekranı: kazanan 6 karttan 2, kaybeden 3 karttan 1 joker seçer (20 sn, seçmezse rastgele); beraberlik kuralı.
- Sohbet: seçilen kartlar üstte sabit, 7:00 sayaç (sunucuda chatEndsAt), son 60 sn uyarı, süre bitince salt-okunur + alt panel (Arkadaş ekle, Yeni oyun, 👍/👎).
- Mesajlar yalnızca Redis'te (room:{id}:msgs, TTL 24 saat); Postgres'e yazılmaz.
- packages/shared/filter.ts: normalize + Aho-Corasick + maskeleme + 10 dk'da 5 ihlalde 10 dk susturma; rastgele sohbette link/e-posta/telefon/@kullanıcı engeli. badwords.tr.txt boş şablon olarak sunucuda.
- Raporla (son 50 mesaj snapshot) ve Engelle; 24 saatte 3 farklı kişiden rapor alan kullanıcı otomatik 24 saat eşleşmeden çıkar.
- Rate limitler SPEC §15'teki gibi.
Testler: filtre normalize örnekleri (leet, Türkçe karakter, tekrar eden harf), kısa köklerde tam kelime eşleşmesi, link engeli, süre bitince mesaj reddi.
```

## Sprint 5 — Arkadaşlık, DM (24 saat), davet, hesap taşıma

```
SPEC §5.8, §10, §18 ve §4 (madde 3) bölümlerini uygula:
- Arkadaşlık isteği (oda yaşadığı sürece), karşılıklı istekte otomatik kabul, gelen/giden istekler, arkadaşlıktan çıkarma, engelleme etkileri.
- DM: Postgres Message, expiresAt = createdAt + 24 saat; her 5 dakikada 5000'lik partilerle silme işi; okuma sorgularında expiresAt > now(); "Mesajlar 24 saat sonra kaybolur" şeridi; ilk satırda tanışma sistem mesajı. Rastgele sohbet geçmişi taşınmaz.
- DM'de link serbest: tıklanabilir, rel="noopener noreferrer nofollow ugc", tıklayınca "Siteden ayrılıyorsun" onayı. Kelime filtresi DM'de de geçerli.
- Okunmamış rozeti (lastReadAt), çevrimiçi arkadaşa anlık bildirim.
- "Birlikte oyna" daveti: özel oda, yine rastgele kategori + motor, sohbet süresiz.
- Hesap taşıma kodu: 8 karakter (0/O, 1/I hariç), 10 dk, tek kullanımlık.
- scripts/optimize-avatars.ts: avatars/raw/*.png → 256 ve 512 px webp (sharp).
Testler: 24 saati geçen mesaj okunmaz ve silme işinden sonra yoktur; engellenince arkadaşlık ve istekler silinir; taşıma kodu ikinci kez kullanılamaz.
```

## Sprint 6 — Admin, yasal, lansman hazırlığı

```
SPEC §15 ve §16 S6'yı uygula:
- /admin (Basic Auth + IP allowlist): açık raporlar, snapshot görüntüleme, ban/unban.
- AccessLog: bağlantı, eşleşme ve mesaj olaylarında IP + port + zaman damgası.
- KVKK aydınlatma metni, Kullanım Koşulları, Gizlilik sayfaları (şablon metin, "hukukçu tarafından gözden geçirilecek" notuyla), analitik için çerez bandı, Ayarlar → "Hesabımı sil".
- Sentry (web + realtime), production için Dockerfile (realtime), Railway ve Vercel deploy talimatları README'de.
- k6 yük testi script'i: 500 eşzamanlı socket, eşleşme + oyun + sohbet akışı.
Bitince tüm testleri ve lint/typecheck'i çalıştır, lansman kontrol listesini README'ye ekle.
```
