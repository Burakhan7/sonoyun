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

## Yayına alma (Hetzner, tek sunucu)

Her şey tek sunucuda Docker Compose ile çalışır: Caddy (HTTPS), web, realtime, Postgres ve Redis. İnternete yalnızca Caddy açıktır. `/socket.io` istekleri realtime'a, geri kalanı web'e gider; bu yüzden tek alan adı yeter. Dosyalar [deploy/](deploy/) klasöründedir.

### 1. Alan adı

DNS'te iki `A` kaydı aç: `@` ve `www`, ikisi de sunucunun IPv4 adresine. Cloudflare kullanılıyorsa proxy (turuncu bulut) **kapalı** olsun; aksi halde ziyaretçi IP'si yerine Cloudflare'in IP'si kaydedilir.

### 2. Sunucuyu hazırla (bir kez)

Ubuntu 24.04, Docker ve Docker Compose eklentisi kurulu olmalı. Hetzner Cloud Firewall'da yalnızca 22, 80 ve 443 portlarını aç.

```bash
git clone https://github.com/Burakhan7/sonoyun.git /opt/sonoyun
cd /opt/sonoyun
sudo bash deploy/setup.sh alanadi.com eposta@ornek.com <admin-ip>
```

`setup.sh` rastgele parolalarla `deploy/.env`, `deploy/realtime.env` ve `deploy/web.env` dosyalarını oluşturur, günlük veritabanı yedeğini cron'a ekler. Var olan dosyaların üzerine yazmaz. Admin parolası `deploy/web.env` içindedir.

Kelime listesini sunucuda `deploy/badwords.tr.txt` dosyasına koy. Bu dosya repoya girmez, konteynere salt okunur bağlanır.

### 3. Yayınla ve güncelle

```bash
bash /opt/sonoyun/deploy/deploy.sh
```

`main`'i çeker, imajları yeniden derler, servisleri yeniler ve site HTTPS'ten cevap verene kadar bekler. Migration'lar realtime açılırken otomatik uygulanır. **Realtime tek kopya çalışır:** canlı oyun durumu süreç belleğindedir, deploy sırasında süren oyunlar biter.

### 4. Yedekler ve bakım

- Veritabanı her gece 03:30'da `/var/backups/sonoyun` içine alınır, son 14 yedek tutulur. Hetzner panelinden sunucu yedeğini de aç; aksi halde sunucu kaybolursa yedekler de gider.
- Geri yükleme: `gunzip -c yedek.sql.gz | docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec -T postgres psql -U app -d oyun_sohbet`
- Loglar: `docker compose -f deploy/docker-compose.yml --env-file deploy/.env logs -f realtime`
- Konteyner logları 3 × 10 MB ile sınırlıdır; eski imajlar her deploy'da silinir.

### 5. Yük testi

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
- [ ] 5651 kayıtlarının (IP, kaynak port, zaman) yeterliliği hukukçuyla değerlendirildi
- [ ] Silinen hesapların rapor kayıtlarının saklama süresi belirlendi
- [ ] Yurt dışı veri aktarımı (Hetzner, Almanya; kullanılırsa Sentry ve Plausible) için KVKK m.9 dayanağı belirlendi

**İçerik ve ürün**

- [ ] Sunucudaki `deploy/badwords.tr.txt` dolduruldu (boşken küfür maskelenmez)
- [ ] Nihai ürün adı, logo ve slogan belirlendi

**Altyapı**

- [ ] `deploy/setup.sh` çalıştırıldı, DNS kayıtları sunucuyu gösteriyor
- [ ] `/ready` Redis ve veritabanı için `ok` dönüyor
- [ ] Günlük veritabanı yedeği oluşuyor, Hetzner sunucu yedeği açık
- [ ] Yük testi staging ortamında geçti
- [ ] `/admin` izinli IP dışından 404, izinli IP'den parolayla açılıyor
- [ ] İki farklı ağdan gerçek cihazlarla eşleşme, sohbet ve DM denendi
