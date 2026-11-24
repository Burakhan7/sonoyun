# Proje Spesifikasyonu — "Önce oyun, sonra sohbet" (çalışma adı)

> Bu doküman OpenAI Codex'e verilmek üzere yazıldı; çalışma kuralları kök dizindeki `AGENTS.md` dosyasında. Her bölüm doğrudan uygulanabilir. Hukukçu teyidi gereken tek nokta **[KARAR]** ile işaretli.

---

## 1. Ürün özeti ve kesinleşen kararlar

Rastgele iki kişi eşleşir → sunucu **rastgele bir kategori** ve o kategoriye uygun **rastgele bir mini oyun** seçer → oyun 1–3 dk sürer → kazanan **2 soru kartı**, kaybeden **1 joker kart** seçer → **7 dakikalık** sohbet başlar → taraflar arkadaşlık isteği gönderebilir; karşılıklı kabulde arkadaşlık kalıcı olur ve DM açılır (DM mesajları 24 saat saklanır).

| Konu | Karar |
|---|---|
| Platform | Mobil + masaüstü uyumlu web sitesi (responsive). Native uygulama yok. |
| Hedef kitle | Türkiye, Türkçe arayüz, 18+ |
| Kimlik | Sadece misafir (cihaz bazlı). Kayıt yok. Cihaz taşımak için "Hesap taşıma kodu". |
| Kategori | Kullanıcı seçemez. Tamamen rastgele (son 3 kategori tekrar etmez). |
| Tekrar eşleşme | Kullanıcının **son 20 eşleşmesi** ile tekrar eşleşmez. Engellenenlerle asla. |
| Bot | **Yok.** |
| Online sayacı | **Gerçek** sayı gösterilir. |
| Sohbet süresi | **7 dakika**. Süre bitince sohbet salt-okunur olur; devam için arkadaş olmak gerekir. |
| Moderasyon | Sadece kelime filtresi (+ link/telefon engeli) + Raporla/Engelle butonları. |
| Kategoriler | 16 adet (bkz. §7) |
| Rastgele sohbet geçmişi | Arkadaş olunca DM'e **taşınmaz**. |
| DM saklama | Her DM mesajı gönderildikten **24 saat sonra** kalıcı olarak silinir. Arkadaşlık kalıcıdır. |
| Link paylaşımı | Rastgele sohbette engelli; **arkadaşlar arası DM'de serbest**. |
| Avatarlar | Gemini ile üretilmiş 24 hayvan illüstrasyonu (bkz. §18). Takma ad ile avatar aynı hayvandır. |
| Geliştirme | OpenAI Codex (`AGENTS.md` + bu doküman) |

---

## 2. Teknoloji yığını

| Katman | Seçim | Neden |
|---|---|---|
| Frontend | **Next.js 15 (App Router) + TypeScript + Tailwind CSS** | SSR'lı landing (SEO), mobil uyumlu, hızlı geliştirme |
| UI animasyon | Framer Motion | Kategori çarkı, kart açılışları |
| Realtime sunucu | **Node.js 22 + Fastify + Socket.IO** | Oyun ve sohbet için kalıcı WebSocket; Vercel uzun bağlantı desteklemediği için ayrı servis |
| State/kuyruk | **Redis 7** (ioredis) | Eşleşme kuyruğu, oda durumu, online sayacı, son-20 listesi, rate limit; Socket.IO Redis adapter ile yatay ölçek |
| Veritabanı | **PostgreSQL 16 + Prisma** | Kullanıcı, arkadaşlık, DM, rapor, eşleşme geçmişi, 5651 logları |
| Ortak kod | `packages/shared` | Zod şemaları, socket event tipleri, oyun kuralları, kelime filtresi |
| Monorepo | pnpm workspaces + Turborepo | |
| Hosting | Web → **Vercel**; Realtime + Redis + Postgres → **Railway** (ya da Fly.io + Neon + Upstash TCP Redis) | Düşük başlangıç maliyeti |
| Hata izleme | Sentry (web + realtime) | |
| Analitik | PostHog veya Plausible (KVKK açısından çerez onayıyla) | |

---

## 3. Repo yapısı

```
/
├─ apps/
│  ├─ web/                 # Next.js
│  │  ├─ app/
│  │  │  ├─ page.tsx               # Açılış
│  │  │  ├─ play/page.tsx          # Eşleşme → oyun → sonuç → sohbet (tek sayfa, state machine)
│  │  │  ├─ friends/page.tsx
│  │  │  ├─ messages/[id]/page.tsx
│  │  │  ├─ settings/page.tsx      # takma ad yenile, taşıma kodu
│  │  │  └─ (legal)/kullanim-kosullari, gizlilik, kvkk
│  │  └─ lib/socket.ts
│  └─ realtime/            # Fastify + Socket.IO
│     ├─ src/
│     │  ├─ index.ts
│     │  ├─ auth.ts               # guest token doğrulama
│     │  ├─ matchmaking.ts
│     │  ├─ rooms.ts              # oda state machine
│     │  ├─ games/                # oyun motorları (§8)
│     │  ├─ chat.ts
│     │  ├─ friends.ts
│     │  ├─ presence.ts           # online sayacı
│     │  └─ logging5651.ts
│     └─ prisma/schema.prisma
├─ packages/
│  └─ shared/
│     ├─ events.ts               # socket event isimleri + payload tipleri
│     ├─ games.ts                # oyun kuralları, puanlama
│     ├─ filter.ts               # kelime filtresi
│     └─ content/questions.json  # soru havuzu (üretilmiş dosya, elle düzenlenmez)
├─ content/                    # soru kaynakları (a.txt … d.txt, satır başına bir içerik)
├─ scripts/
│  ├─ build_questions.py       # content/*.txt → questions.json + doğrulama
│  └─ optimize-avatars.ts      # avatars/raw/*.png → webp
├─ docs/
│  ├─ SPEC.md
│  ├─ CODEX_PROMPTS.md
│  └─ GEMINI_AVATARS.md
├─ AGENTS.md
└─ turbo.json
```

---

## 4. Kimlik (misafir, cihaz bazlı)

1. İlk açılışta `POST /api/guest` → sunucu `User` kaydı oluşturur:
   - `id` (cuid), `avatarId` (24 hayvandan biri, ör. `kartal`), `nickname` = rastgele sıfat + o hayvanın adı (ör. "Enerjik Kartal"). Sıfat ve hayvan listesi §18'de.
2. Sunucu imzalı **JWT** döner (HS256, 365 gün). Saklama:
   - `httpOnly; Secure; SameSite=Lax` çerez (web API çağrıları için),
   - ayrıca `localStorage` (Socket.IO handshake `auth.token` için).
3. **Hesap taşıma kodu:** Ayarlar sayfasında "Kodu göster" → 8 karakterlik kod (ör. `K7Q2-M9XA`, karışmaması için 0/O, 1/I hariç). Kod 10 dk geçerli, tek kullanımlık. Yeni cihazda "Kodu gir" → aynı `User` için yeni token.
4. Takma ad + avatar günde 1 kez birlikte yenilenebilir (rastgele üretilir, serbest metin yok → küfürlü isim riski sıfır).
5. Ban: `User.bannedUntil`. Ban kaçırmayı zorlaştırmak için cihaz hash'i (§6, ek bağımlılık olmadan tarayıcı özelliklerinden üretilir) ve IP kayıt altında tutulur.

---

## 5. Ekran akışı

```
[Açılış] ──Oyna──▶ [Eşleşme aranıyor] ──bulundu──▶ [Kategori çarkı 3sn] ──▶ [Oyun]
                         │                                                  │
                         └─60sn yok──▶ [Kimse yok ekranı]                   ▼
                                                                    [Sonuç + kart seçimi]
                                                                            │
                                                                            ▼
                                                                   [Sohbet 7:00 ⏱]
                                                                            │
                                                     ┌──────────────────────┼─────────────────┐
                                                     ▼                      ▼                 ▼
                                              [Arkadaş ekle]          [Yeni oyun]       [Raporla/Engelle]
```

### 5.1 Açılış (`/`)
- Logo, slogan, büyük **Oyna** butonu.
- Üstte: avatar + takma ad (dokununca yenile), **gerçek** online sayısı (`🟢 23 çevrimiçi`), 👥 arkadaşlar, 💬 mesajlar (okunmamış rozeti).
- İlk girişte modal: **18+ onayı** + 3 maddelik kurallar + KVKK aydınlatma linki. Onay `User.acceptedTermsAt`'e yazılır.
- Altta: "Nasıl çalışır?" (3 adım), kategori ikonları şeridi (dekoratif), Kullanım Koşulları · Gizlilik · KVKK.

### 5.2 Eşleşme aranıyor
- Animasyon + "Rakip aranıyor…" + geçen süre + İptal.
- 20. saniyede alt metin: "Biraz sakin bir an, birazdan biri gelir."
- **60 sn** dolunca → **Kimse yok ekranı**:
  - "Şu an kimse yok 😕" + gerçek online sayısı,
  - **Arkadaşını davet et** (paylaşım linki, `navigator.share` / WhatsApp),
  - **Aramaya devam et** (kuyruğa geri döner),
  - **Bildirim al**: tarayıcı açık kaldığı sürece biri gelince ses + sekme başlığı yanıp söner ("🔔 Rakip bulundu!").
- Bot yok; kullanıcıya rakip varmış gibi hiçbir şey gösterilmez.

### 5.3 Kategori çarkı (3 sn)
- Sunucu seçimi önceden yapmıştır; istemci sadece animasyonu oynatır ve sunucunun gönderdiği sonuçta durur.
- Gösterilen: kategori emojisi + adı + oyun adı + 1 cümle kural.
- Üstte rakip: avatar + takma ad.

### 5.4 Oyun
- Üstte: iki oyuncu, skorlar, tur göstergesi, tur sayacı (çember).
- Ortada: soru/oyun alanı. Altta: cevap butonları (mobilde başparmak bölgesi).
- Bağlantı koparsa 15 sn yeniden bağlanma süresi; dönmezse rakip hükmen kazanır.

### 5.5 Sonuç + kart seçimi
- "🏆 Kartal kazandı!" + skor + uyum yüzdesi (yalnızca Ayna oyununda, bkz. §8).
- **Kazanan:** 6 kart görür (o kategoriden 2 Hafif 🟢, 2 Kişisel 🟡, 2 Cesaret 🔴) → **2 tane seçer** (20 sn; seçmezse rastgele).
- **Kaybeden:** 3 kart görür (her seviyeden 1) → **1 joker seçer**.
- Beraberlik: ikisi de 1'er kart seçer + sistem 1 rastgele kart ekler.
- Seçim sırasında karşı taraf "Kartlar seçiliyor…" görür.

### 5.6 Sohbet (7 dakika)
- Üstte sabit: seçilen kartlar ("Kartal soruyor: …", "Tilki'nin jokeri: …").
- Sayaç: `7:00` → `0:00`. Son 60 sn kırmızı + "Süre bitiyor — sohbet devam etsin mi? **Arkadaş ekle**".
- Mesaj: yalnızca metin + emoji, maks. 500 karakter, 1 sn'de en fazla 1 mesaj, 10 sn'de en fazla 6 mesaj.
- "Yazıyor…" göstergesi.
- Sağ üst menü: **Raporla**, **Engelle**, **Sohbetten çık**.
- Süre dolunca: giriş kutusu kapanır, sohbet salt-okunur, alt panel açılır (§5.7).
- Taraflardan biri çıkarsa diğerine "Tilki sohbetten ayrıldı" + alt panel.

### 5.7 Sohbet sonrası panel
- **Arkadaş ekle** (veya "İstek gönderildi ✓" / "Tilki seni eklemek istiyor → Kabul et").
- **Yeni oyun** (doğrudan kuyruğa).
- 👍/👎 "Sohbet nasıldı?" (yalnızca dahili kalite metriği).

### 5.8 Arkadaşlar (`/friends`) ve Mesajlar (`/messages`)
- Liste: avatar, takma ad, 🟢/⚪ durum, son mesaj önizleme.
- Bekleyen istekler sekmesi (gelen/giden).
- Arkadaş satırında: **Mesaj**, **Birlikte oyna** (özel oda daveti → yine rastgele kategori + oyun, sohbet süresiz), **Arkadaşlıktan çıkar**, **Engelle**.
- DM: süre sınırı yok ama **her mesaj 24 saat sonra silinir**. Sohbetin üstünde sabit bilgi şeridi: "⏳ Mesajlar 24 saat sonra kaybolur." Her mesajın yanında kalan süre (hover/uzun basınca).
- DM'de kelime filtresi geçerli, link serbest (bkz. §11).

---

## 6. Eşleşme algoritması

**Redis yapıları**
- `mm:queue` → ZSET (member = userId, score = kuyruğa giriş zamanı ms)
- `mm:recent:{userId}` → LIST (son 20 rakip userId)
- `block:{userId}` → SET (engellediği + onu engelleyen userId'ler; Postgres'ten başlangıçta yüklenir)
- `mm:lock` → kısa süreli kilit (SET NX PX 500)

**İşleyiş** (her 500 ms'de bir tick; tek worker kilitle çalışır)

```ts
async function tick() {
  if (!(await redis.set('mm:lock', '1', 'PX', 500, 'NX'))) return;
  const waiting = await redis.zrange('mm:queue', 0, 199); // en uzun bekleyen önce
  const used = new Set<string>();

  for (const a of waiting) {
    if (used.has(a)) continue;
    const aRecent = new Set(await redis.lrange(`mm:recent:${a}`, 0, 19));
    const aBlock  = new Set(await redis.smembers(`block:${a}`));

    for (const b of waiting) {
      if (b === a || used.has(b)) continue;
      if (aRecent.has(b) || aBlock.has(b)) continue;
      const bRecent = await redis.lrange(`mm:recent:${b}`, 0, 19);
      if (bRecent.includes(a)) continue;
      if (await sameDevice(a, b)) continue; // aynı IP + (aynı cihaz hash'i veya hash yok) → eşleştirme

      used.add(a); used.add(b);
      await redis.zrem('mm:queue', a, b);
      await pushRecent(a, b); await pushRecent(b, a);
      await createRoom(a, b);
      break;
    }
  }
}

async function pushRecent(u: string, other: string) {
  await redis.multi()
    .lrem(`mm:recent:${u}`, 0, other)
    .lpush(`mm:recent:${u}`, other)
    .ltrim(`mm:recent:${u}`, 0, 19)
    .exec();
}
```

- **Aynı cihaz kuralı:** Mobil operatörler CGNAT ile çok sayıda kişiye aynı IP'yi verdiği için IP tek başına engel değildir. Aynı IP'deki iki kişi yalnızca cihaz hash'leri aynıysa veya taraflardan birinin hash'i yoksa eşleşmez. Aynı model telefonlar aynı hash'i üretebildiği için hash, farklı IP'ler arasında engel değildir. Hash istemcide tarayıcı özelliklerinden (SHA-256, ilk 128 bit) üretilir ve Socket.IO handshake'inde `auth.device` olarak gönderilir; sunucu son değeri `User.deviceHash`'e yazar.
- 200'den fazla bekleyen olursa (iyi bir sorun) parçalara bölünür.
- Eşleşen ikili Postgres `Match` tablosuna da yazılır (analitik + 5651).

---

## 7. Kategoriler (16)

| id | Ad | Emoji |
|---|---|---|
| `mutfak` | Mutfak & Yemek | 🍳 |
| `muzik` | Müzik | 🎵 |
| `nostalji` | Nostalji (90'lar/2000'ler) | 🧒 |
| `okul` | Okul & Kampüs | 🎓 |
| `is` | İş & Ofis Hayatı | 💼 |
| `seyahat` | Seyahat & Şehirler | ✈️ |
| `spor` | Spor | ⚽ |
| `hayvanlar` | Evcil Hayvanlar | 🐾 |
| `internet` | İnternet & Meme Kültürü | 📱 |
| `sehir` | Şehir & Toplu Taşıma | 🚌 |
| `kultur` | Türk Kültürü & Gelenekler | 🎉 |
| `alisveris` | Alışveriş & Para | 🛒 |
| `gece` | Gece & Alışkanlıklar | 🌙 |
| `yasaydi` | Ya Şöyle Olsaydı? | 🧠 |
| `dizi_film` | Dizi & Film | 🎬 |
| `oyun` | Oyun Dünyası | 🎮 |

**Seçim kuralı:** Odadaki iki oyuncunun son 3 kategorisinin birleşimi hariç tutulur, kalanlardan ağırlıksız rastgele seçilir. Sonra o kategoride yeterli içeriği olan oyun motorları arasından rastgele motor seçilir.

---

## 8. Oyun motorları

Tüm oyunlar **sunucu otoriterdir**: doğru cevap istemciye tur bitmeden gönderilmez, süre sunucuda tutulur, puanı sunucu hesaplar.

| Motor id | Ad | Kural | Tur | Puan |
|---|---|---|---|---|
| `mc` | Hızlı Bilgi | 4 şıklı soru, 12 sn | 5 | Doğru = 100 + kalan sn × 5. Yanlış = 0 |
| `emoji` | Emoji Tahmin | Emojilerden yapımı/kavramı bul, 4 şık, 15 sn | 5 | `mc` ile aynı |
| `estimate` | Yaklaşık | Sayı gir (yıl, metre, adet…), 15 sn | 3 | Rakibe göre daha yakın olan turu alır (1 puan). Tam isabet (birebir doğru cevap; içerikteki `tolerance` bonus vermez) +1 bonus. Eşitlikte önce gönderen alır |
| `tf` | Doğru mu Yanlış mı | Hızlı D/Y, 6 sn | 7 | Doğru = 1; önce doğru cevaplayan +1 bonus |
| `mixed` | Karışık Tur | Kategorideki mc/emoji/estimate/tf'den 5 soru karışık | 5 | Her soru kendi süresi ve kuralıyla oynanır; **turu kazanan 1 puan alır** (eşitlikte önce cevaplayan) |
| `ayna` | Ayna (Bu mu Şu mu) | Her turda iki şık. Oyuncu hem **kendi seçimini** yapar hem de **rakibin ne seçeceğini tahmin eder**, 10 sn | 5 | Doğru tahmin = 1 puan. Ayrıca **uyum yüzdesi** = aynı seçim yapılan tur / toplam tur |

**Kategori → motor eşlemesi**
- `yasaydi` → yalnızca `ayna`.
- Diğer 15 kategori → `mc`, `emoji`, `estimate`, `tf`, `mixed`, `ayna` (kategoride o tipte en az tur sayısı kadar soru varsa).

**İçerik:** `questions.json` (v2) kategori başına 40 yarışma sorusu (12 mc, 12 tf, 8 estimate, 8 emoji), 20 Ayna turu (Ya Şöyle Olsaydı'da 40) ve 30 sohbet kartı (10 hafif, 10 kişisel, 10 cesaret) içerir. Toplam: 600 soru, 340 Ayna turu, 480 kart. Bir motor, o kategoride o tipte **en az 8** içerik varsa seçilebilir → lansmanda tüm motorlar tüm kategorilerde aktif. İçerik `content/*.txt` kaynaklarından `scripts/build_questions.py` ile üretilir; JSON elle düzenlenmez.

**Şık sırası:** JSON'da doğru cevap her zaman `answerIndex: 0`. Sunucu her soruyu göndermeden önce şıkları **karıştırmalı** ve doğru indeksi yalnızca kendi bellekte tutmalı.

**Soru seçimi:** Kullanıcının son 200 gördüğü soru id'si (`seen:{userId}`, Redis LIST) mümkünse hariç tutulur.

**Tur akışı (sunucu)**
```
ROUND_START {roundNo, question(cevapsız), endsAt}
  → istemciler ANSWER gönderir (ilk gönderim kilitlenir)
  → süre biter ya da ikisi de cevaplar
ROUND_RESULT {correct, answers, scores}
  → 2 sn bekle → sonraki tur
GAME_OVER {winnerId | null, scores, harmony?}
```

---

## 9. Soru kartları ve sohbet

- Kartlar `questions.json` → `cards[]` içinde, kategori + seviye (`light` | `personal` | `bold`).
- Kartlar sohbetin üstüne sabitlenir; sohbet mesajı olarak da ilk satırda sistem mesajı şeklinde düşer.
- Sohbet odası yalnızca Redis'te tutulur (`room:{id}:msgs`, TTL 24 saat) — **rastgele sohbet mesajları Postgres'e kalıcı yazılmaz**. İstisna: **Raporla** basılırsa son 50 mesaj `Report.snapshot` alanına kopyalanır.
- Arkadaşlık kurulursa rastgele sohbet geçmişi DM'e **taşınmaz** (kesin karar). DM boş başlar; ilk satırda sistem mesajı: "Kartal ile [Kategori] oynayarak tanıştınız 🎉".
- 7 dakika sunucuda tutulur: `room:{id}:chatEndsAt`. Süre bitince sunucu `CHAT_ENDED` yayınlar ve sonraki mesajları reddeder.

---

## 10. Arkadaşlık ve DM

- Sohbet sırasında veya sonrasında (oda yaşadığı sürece, 24 saat) **Arkadaş ekle**.
- İki taraf da göndermişse → otomatik kabul.
- Tek taraf göndermişse → karşı tarafa istek düşer (`/friends` → Gelen istekler) + çevrimiçiyse anlık bildirim.
- Kabulde `Friendship` + `Conversation` oluşur.
- DM mesajları Postgres'te (`Message`), sayfalama 30'ar. Her mesaj `expiresAt = createdAt + 24 saat` ile yazılır.
- **Silme işi:** realtime servisinde her 5 dakikada bir çalışan iş: `DELETE FROM "Message" WHERE "expiresAt" < now()` (5000'lik partiler). Okuma sorguları ayrıca `expiresAt > now()` filtresi uygular, böylece silinmeyi bekleyen mesaj da görünmez.
- Rapor edilen DM'lerde son 50 mesaj silinmeden önce `Report.snapshot`'a kopyalanır.
- Okundu bilgisi: `ConversationMember.lastReadAt`.
- Arkadaş sınırı: 200. Bekleyen giden istek sınırı: 50.
- Engelleme: arkadaşlık + bekleyen istekler silinir, DM gizlenir, eşleşmede kalıcı olarak elenir.

---

## 11. Kelime filtresi (`packages/shared/filter.ts`)

Tek filtre tüm metinlere uygulanır (sohbet, DM).

1. **Normalize:** küçük harf (`tr-TR`), `İ→i, I→ı`; Türkçe karakterleri düzleştir (`ş→s, ç→c, ğ→g, ı→i, ö→o, ü→u`); leet dönüşümü (`0→o, 1→i, 3→e, 4→a, 5→s, 7→t, @→a, $→s`); harf dışı karakterleri sil; tekrar eden harfleri teke indir (`aaaa→a`).
2. **Eşleştir:** normalize metinde `badwords.tr.txt` listesindeki kökleri ara (Aho-Corasick; `ahocorasick` npm paketi). Kısa köklerde (≤3 harf) yalnızca **tam kelime** eşleşmesi (yanlış pozitifleri önler).
3. **İşlem:** eşleşen kelime orijinal metinde `***` ile maskelenir, mesaj yine gönderilir. Aynı kullanıcı 10 dk içinde 5 maskelenmiş mesaj gönderirse 10 dk sohbet susturması.
4. **Link/iletişim engeli:** URL (`https?://`, `www.`, `\.(com|net|org|tr|io|me|gg)\b`), e-posta, telefon (`(\+90|0)?\s?5\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}`), `@kullanıcıadı` kalıpları → rastgele sohbette **gönderilmez**, kullanıcıya "Link ve iletişim bilgisi paylaşılamaz" uyarısı.
   **DM'de (arkadaşlar arası) link serbest:** linkler tıklanabilir gösterilir (`target="_blank" rel="noopener noreferrer nofollow ugc"`), tıklayınca "Siteden ayrılıyorsun: alanadi.com" onay penceresi açılır. Link önizlemesi (unfurl) yok.
5. `badwords.tr.txt` boş şablon olarak gelir; ekip doldurur ve yalnızca sunucu tarafında yüklenir (istemciye gönderilmez).

---

## 12. Online sayacı (gerçek)

- Her bağlı socket `presence:online` SET'ine userId ekler (aynı kullanıcı birden fazla sekmede 1 sayılır; `presence:conn:{userId}` sayaç ile).
- Bağlantı koptuğunda sayaç 0'a inerse SET'ten çıkar.
- Her 5 sn'de bir `SCARD presence:online` tüm istemcilere `ONLINE_COUNT` ile yayınlanır.
- Ek göstergeler (gerçek veriler): "Şu an X oyun oynanıyor" (`SCARD rooms:active`), "Bugün Y oyun oynandı" (`INCR stats:games:{yyyy-mm-dd}`).

---

## 13. Veri modeli (Prisma)

```prisma
model User {
  id             String   @id @default(cuid())
  nickname       String
  avatarId       String   // §18 listesindeki hayvan id'si
  createdAt      DateTime @default(now())
  lastSeenAt     DateTime @default(now())
  acceptedTermsAt DateTime?
  nicknameChangedAt DateTime?
  bannedUntil    DateTime?
  deviceHash     String?
  transferCodes  TransferCode[]
  sentRequests   FriendRequest[] @relation("from")
  recvRequests   FriendRequest[] @relation("to")
  @@index([deviceHash])
}

model TransferCode {
  code      String   @id
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  expiresAt DateTime
  usedAt    DateTime?
}

model Match {
  id         String   @id @default(cuid())
  userAId    String
  userBId    String
  category   String
  engine     String
  winnerId   String?
  scoreA     Int
  scoreB     Int
  harmony    Int?     // ayna uyum yüzdesi
  startedAt  DateTime @default(now())
  endedAt    DateTime?
  chatRating Json?    // {userId: 1|-1}
  @@index([userAId]) @@index([userBId])
}

model FriendRequest {
  id        String   @id @default(cuid())
  fromId    String
  toId      String
  from      User     @relation("from", fields: [fromId], references: [id])
  to        User     @relation("to", fields: [toId], references: [id])
  matchId   String?
  status    String   @default("pending") // pending|accepted|declined|cancelled
  createdAt DateTime @default(now())
  @@unique([fromId, toId])
}

model Friendship {
  userLowId  String
  userHighId String
  createdAt  DateTime @default(now())
  @@id([userLowId, userHighId])
}

model Block {
  blockerId String
  blockedId String
  createdAt DateTime @default(now())
  @@id([blockerId, blockedId])
}

model Conversation {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())
  members   ConversationMember[]
  messages  Message[]
}

model ConversationMember {
  conversationId String
  userId         String
  lastReadAt     DateTime @default(now())
  hidden         Boolean  @default(false)
  conversation   Conversation @relation(fields: [conversationId], references: [id])
  @@id([conversationId, userId])
}

model Message {
  id             String   @id @default(cuid())
  conversationId String
  senderId       String
  body           String   @db.VarChar(500)
  createdAt      DateTime @default(now())
  expiresAt      DateTime // createdAt + 24 saat
  conversation   Conversation @relation(fields: [conversationId], references: [id])
  @@index([conversationId, createdAt])
  @@index([expiresAt])
}

model Report {
  id         String   @id @default(cuid())
  reporterId String
  reportedId String
  matchId    String?
  reason     String   // taciz|kufur|spam|reşit-olmayan|diger
  note       String?  @db.VarChar(300)
  snapshot   Json     // son 50 mesaj
  status     String   @default("open")
  createdAt  DateTime @default(now())
  @@index([reportedId, status])
}

model AccessLog {          // 5651 trafik kaydı
  id        BigInt   @id @default(autoincrement())
  userId    String?
  ip        String
  port      Int?
  event     String   // connect|disconnect|match|message
  at        DateTime @default(now())
  @@index([at])
}
```

---

## 14. Socket event listesi (`packages/shared/events.ts`)

İstemci → Sunucu

| Event | Payload |
|---|---|
| `queue:join` | `{}` |
| `queue:leave` | `{}` |
| `game:answer` | `{ roundNo, answer: string \| number, prediction?: 'a'\|'b' }` |
| `cards:pick` | `{ cardIds: string[] }` |
| `chat:send` | `{ body }` |
| `chat:typing` | `{}` |
| `chat:leave` | `{}` |
| `friend:request` | `{ userId }` |
| `friend:respond` | `{ requestId, accept: boolean }` |
| `dm:send` | `{ conversationId, body }` |
| `dm:read` | `{ conversationId }` |
| `user:block` | `{ userId }` |
| `user:report` | `{ userId, reason, note? }` |
| `invite:create` | `{ friendId }` |

Sunucu → İstemci

| Event | Payload |
|---|---|
| `online:count` | `{ online, activeGames, gamesToday }` |
| `queue:status` | `{ waitingSec }` |
| `match:found` | `{ roomId, opponent: {id,nickname,avatarId}, category, engine, rules }` |
| `round:start` | `{ roundNo, total, question, endsAt }` |
| `round:result` | `{ roundNo, correct, answers, scores }` |
| `game:over` | `{ winnerId \| null, scores, harmony? }` |
| `cards:offer` | `{ cards: Card[], pickCount, endsAt }` |
| `chat:start` | `{ pinned: {byUserId, card}[], endsAt }` |
| `chat:message` | `{ id, senderId, body, at }` |
| `chat:typing` | `{ userId }` |
| `chat:ended` | `{ reason: 'timeout'\|'left'\|'disconnect' }` |
| `friend:incoming` | `{ requestId, from }` |
| `friend:accepted` | `{ userId, conversationId }` |
| `dm:message` | `{ conversationId, message }` |
| `error` | `{ code, message }` |

Oda durum makinesi: `MATCHED → SPIN → PLAYING → PICKING → CHATTING → ENDED`

---

## 15. Güvenlik, rate limit, hukuki

- Socket handshake'te JWT doğrulama; `bannedUntil` kontrolü.
- Rate limit (Redis sliding window): `queue:join` 10/dk, `chat:send` 6/10 sn, `friend:request` 20/saat, `user:report` 10/gün.
- **Otomatik koruma:** 24 saatte **3 farklı kişiden** rapor alan kullanıcı otomatik 24 saat eşleşmeden çıkarılır, admin incelemesine düşer.
- Admin paneli (MVP için basit): `/admin` (Basic Auth + IP allowlist) → açık raporlar, snapshot görüntüleme, ban.
- **5651:** `AccessLog`'a bağlantı IP + port + zaman damgası yazılır; saklama süresi ve kapsamı için hukukçu teyidi alınmalı (yer sağlayıcı yükümlülükleri). **[KARAR]**
- **KVKK:** Aydınlatma metni, çerez bandı (analitik için), "Hesabımı sil" (Ayarlar → tüm veriler silinir, AccessLog yasal süre boyunca saklanır).
- **18+:** Onay modali + kurallarda "18 yaşından küçükler kullanamaz". Rapor nedenlerinde "Reşit olmadığını düşünüyorum" seçeneği; bu raporlar öncelikli incelenir.

---

## 16. MVP yol haritası

| Sprint | Kapsam |
|---|---|
| **S1 (1 hafta)** | Monorepo, guest auth + JWT, açılış sayfası, Socket.IO bağlantısı, gerçek online sayacı |
| **S2 (1 hafta)** | Eşleşme kuyruğu (son-20 + engel kuralı), oda state machine, kategori çarkı, `mc` + `tf` motorları |
| **S3 (1 hafta)** | `emoji`, `estimate`, `mixed`, `ayna` motorları; sonuç ekranı + kart seçimi |
| **S4 (1 hafta)** | 7 dk sohbet, kelime filtresi, link engeli, Raporla/Engelle, sohbet sonrası panel |
| **S5 (1 hafta)** | Arkadaşlık + DM (24 saat silme işi, DM'de link) + okunmamış rozeti, "Birlikte oyna" daveti, hesap taşıma kodu, avatar entegrasyonu |
| **S6 (1 hafta)** | Admin paneli, 5651 log, KVKK sayfaları, Sentry, yük testi (k6, 500 eşzamanlı socket), lansman |

---

## 17. Codex için çalışma talimatı

Ayrıntılı kurallar ve sprint istemleri `AGENTS.md` ve `docs/CODEX_PROMPTS.md` içinde. Özet:
1. Codex'e her seferinde **tek sprint** ver; sprint bitince testleri çalıştırıp PR açmasını iste.
2. Socket event isimleri ve payload tipleri **yalnızca** `packages/shared/events.ts`'ten import edilir.
3. Doğru cevaplar istemciye `round:result`'tan önce asla gitmez; her motor için test zorunlu.
4. Eşleşme testleri: "son 20'deki rakiple eşleşmez", "engelli çift asla eşleşmez", "21. eşleşmeden sonra tekrar eşleşebilir".
5. DM testi: "24 saati geçen mesaj okunmaz ve silme işinden sonra veritabanında yoktur".

---

## 18. Avatarlar (Gemini ile üretilir)

- 24 hayvan, her biri tek PNG. Üretim istemleri: `docs/GEMINI_AVATARS.md`.
- Ham dosyalar `apps/web/public/avatars/raw/{id}.png` (1024×1024) olarak konur. `scripts/optimize-avatars.ts` (sharp) bunları `apps/web/public/avatars/{id}.webp` (256×256, kalite 85) ve `{id}@2x.webp` (512×512) olarak üretir.
- Arayüzde avatar her zaman **daire içinde** gösterilir (`border-radius: 50%`). Görsellerdeki düz arka plan rengi daireyi doldurur.
- Görsel yüklenemezse yedek olarak hayvanın emojisi gösterilir.
- Kullanıcı avatar seçemez; takma ad ile birlikte rastgele atanır, günde 1 kez yenilenebilir.

| id | Hayvan | Yedek emoji | Arka plan |
|---|---|---|---|
| kartal | Kartal | 🦅 | #F4C98B |
| tilki | Tilki | 🦊 | #F7B9A0 |
| baykus | Baykuş | 🦉 | #C9B8E8 |
| kedi | Kedi | 🐱 | #FBE3A1 |
| kopek | Köpek | 🐶 | #BFE3C6 |
| panda | Panda | 🐼 | #CDE7F0 |
| aslan | Aslan | 🦁 | #F9D58A |
| kaplan | Kaplan | 🐯 | #F7C6A3 |
| ayi | Ayı | 🐻 | #E2CDB5 |
| tavsan | Tavşan | 🐰 | #F6CFE0 |
| kirpi | Kirpi | 🦔 | #E8D9B0 |
| sincap | Sincap | 🐿️ | #F3C1A0 |
| penguen | Penguen | 🐧 | #BCD8F2 |
| yunus | Yunus | 🐬 | #A9DDF0 |
| ahtapot | Ahtapot | 🐙 | #F2B8C6 |
| kaplumbaga | Kaplumbağa | 🐢 | #C6E5B3 |
| zurafa | Zürafa | 🦒 | #F8DDA0 |
| fil | Fil | 🐘 | #D3D9E8 |
| koala | Koala | 🐨 | #D6E3D1 |
| rakun | Rakun | 🦝 | #D9D2C5 |
| kurbaga | Kurbağa | 🐸 | #CBEBA6 |
| papagan | Papağan | 🦜 | #B8E6D4 |
| flamingo | Flamingo | 🦩 | #F9C5D1 |
| geyik | Geyik | 🦌 | #E9CFAE |

**Sıfatlar (30):** Enerjik, Sakin, Meraklı, Uykucu, Neşeli, Cesur, Utangaç, Hızlı, Bilge, Şakacı, Gizemli, Tatlı, Havalı, Dalgın, Hırslı, Sevimli, Çılgın, Kibar, Maceracı, Yaratıcı, Sabırlı, Konuşkan, Sessiz, Asil, Düşünceli, Huysuz, Pofuduk, Şanslı, Telaşlı, Gezgin.
