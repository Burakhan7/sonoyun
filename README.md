# Önce oyun, sonra sohbet

Rastgele iki kişi eşleşir, kısa bir mini oyun oynar, kartlarını seçer ve 7 dakika sohbet eder. Karşılıklı kabulde arkadaş olurlar ve 24 saatlik DM açılır.

- Ürün tanımı: [docs/SPEC.md](docs/SPEC.md)
- Çalışma kuralları: [AGENTS.md](AGENTS.md)
- Ertelenen işler: [docs/BACKLOG.md](docs/BACKLOG.md)

## Yerel geliştirme

Gerekenler: Node 22, Docker ve Corepack (`corepack enable`).

```bash
pnpm install
cp .env.example .env
cp apps/realtime/.env.example apps/realtime/.env   # JWT_SECRET değerini doldur
cp apps/web/.env.example apps/web/.env.local
docker compose up -d
pnpm --filter realtime exec prisma migrate deploy
pnpm dev                                           # web :3100, realtime :4000
```

| Komut                                      | Görev                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------ |
| `pnpm lint`, `pnpm typecheck`, `pnpm test` | Kalite kontrolleri. Testler Docker'daki Postgres ve Redis'i kullanır     |
| `pnpm build`                               | Üretim derlemesi                                                         |
| `pnpm --filter web test:e2e`               | Tarayıcı testi (önce `pnpm build`; kurulu Edge için `PW_CHANNEL=msedge`) |
| `pnpm dev:reset-matches`                   | Yerelde son-20 rakip listesini temizler                                  |
| `pnpm tsx scripts/optimize-avatars.ts`     | `avatars/raw` içindeki görselleri WebP yapar                             |

Testler yalnızca adı `_test` ile biten yerel bir veritabanında çalışır.

## Yayına alma

### 1. Railway (realtime, Postgres, Redis)

1. Bu repodan yeni proje aç, Postgres 16 ve Redis 7 ekle. Build ayarı [railway.json](railway.json) içinden gelir.
2. Realtime servisine şu değişkenleri gir:

| Değişken                    | Değer                                             |
| --------------------------- | ------------------------------------------------- |
| `NODE_ENV`                  | `production`                                      |
| `DATABASE_URL`, `REDIS_URL` | Railway servis referansları                       |
| `JWT_SECRET`                | En az 32 karakter rastgele değer                  |
| `INTERNAL_API_SECRET`       | En az 32 karakter rastgele değer, Vercel ile aynı |
| `WEB_ORIGIN`                | Sitenin tam adresi, örn. `https://alanadi.com`    |
| `TRUST_PROXY`               | `true` (**zorunlu**, yoksa kimse eşleşemez)       |
| `SENTRY_DSN`                | İsteğe bağlı                                      |

Migration'lar konteyner açılırken otomatik uygulanır. **Tek replika çalıştır:** canlı oyun durumu süreç belleğindedir.

### 2. Vercel (web)

1. Bu repoyu içe aktar. Root Directory: `apps/web`. "Include files outside the root directory" açık kalsın.
2. Şu değişkenleri gir:

| Değişken                               | Değer                                        |
| -------------------------------------- | -------------------------------------------- |
| `NEXT_PUBLIC_REALTIME_URL`             | Realtime servisinin herkese açık adresi      |
| `REALTIME_INTERNAL_URL`                | Aynı adres                                   |
| `INTERNAL_API_SECRET`                  | Railway ile aynı değer                       |
| `ADMIN_USER`, `ADMIN_PASSWORD`         | Admin girişi, güçlü parola                   |
| `ADMIN_IP_ALLOWLIST`                   | Admin'e girecek IP adresleri, virgülle       |
| `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` | İsteğe bağlı                                 |
| `NEXT_PUBLIC_PLAUSIBLE_DOMAIN`         | İsteğe bağlı; ayarlanınca çerez bandı açılır |

`/admin` bu üç admin değeri ayarlanmadan 404 döner.

### 3. Yük testi

Canlı ortama **çalıştırma**, gerçek hesap açar. Staging ortamında:

```bash
docker run --rm -i -e BASE_URL=https://staging-adresi -e TARGET_VUS=500 grafana/k6 run - < load/k6-realtime.js
```

Aynı IP'den çalıştığı için hedefte `MATCH_ALLOW_SAME_IP=true` ve yüksek `GUEST_LIMIT_PER_HOUR` gerekir. Bu ayar production'da reddedilir, bu yüzden hedef `NODE_ENV=production` olmamalıdır.

## Lansman kontrol listesi

**Hukuk (yayından önce zorunlu)**

- [ ] Kullanım Koşulları, Gizlilik ve KVKK şablonları hukukçu tarafından gözden geçirildi, köşeli parantezler dolduruldu
- [ ] Şablon uyarısı `apps/web/components/LegalPage.tsx` içinden kaldırıldı
- [ ] 5651 kayıtlarının kapsamı ve saklama süresi netleşti; silme işi eklendi (şu an hiçbir kayıt silinmez)
- [ ] Reverse proxy arkasında kaynak port alınamıyor; 5651 açısından yeterliliği hukukçuyla değerlendirildi
- [ ] Silinen hesapların rapor kayıtlarının saklama süresi belirlendi
- [ ] Yurt dışı veri aktarımı (Vercel, Railway, Sentry, Plausible) için KVKK m.9 dayanağı belirlendi

**İçerik ve ürün**

- [ ] `apps/realtime/badwords.tr.txt` dolduruldu (boşken küfür maskelenmez)
- [ ] Nihai ürün adı, logo ve slogan belirlendi

**Altyapı**

- [ ] Railway ve Vercel değişkenleri girildi, `TRUST_PROXY=true`
- [ ] `/ready` Redis ve veritabanı için `ok` dönüyor
- [ ] Veritabanı yedekleri açık
- [ ] Yük testi staging ortamında geçti
- [ ] `/admin` izinli IP dışından 404, izinli IP'den parolayla açılıyor
- [ ] İki farklı ağdan gerçek cihazlarla eşleşme, sohbet ve DM denendi
