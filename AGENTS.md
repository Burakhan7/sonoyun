# AGENTS.md

Bu repo bir "önce oyun, sonra sohbet" web sitesidir. Ürünün tamamı `docs/SPEC.md` içinde tanımlıdır. **Herhangi bir işe başlamadan önce `docs/SPEC.md` dosyasını oku.** Bu dosya ile SPEC çelişirse SPEC geçerlidir.

## Teknoloji
- pnpm workspaces + Turborepo monorepo. Node 22, TypeScript `strict: true`.
- `apps/web`: Next.js 15 (App Router) + Tailwind CSS + Framer Motion.
- `apps/realtime`: Fastify + Socket.IO + ioredis + Prisma (PostgreSQL 16).
- Yayın: tek Hetzner sunucusunda Docker Compose (`deploy/`); Caddy HTTPS ve yönlendirmeyi yapar.
- `packages/shared`: Zod şemaları, socket event tipleri (`events.ts`), oyun kuralları (`games.ts`), kelime filtresi (`filter.ts`), içerik (`content/questions.json`).
- Test: Vitest (birim), Playwright (web e2e). Lint: ESLint + Prettier.

## Komutlar
```bash
pnpm install
docker compose up -d            # yerel Postgres + Redis
pnpm --filter realtime prisma migrate dev
pnpm dev                        # web :3100, realtime :4000
pnpm test                       # tüm Vitest testleri
pnpm dev:reset-matches          # yerelde son-20 rakip listesini temizler
pnpm lint && pnpm typecheck
python3 scripts/build_questions.py content packages/shared/content/questions.json
pnpm tsx scripts/optimize-avatars.ts
```
Bir iş bitti sayılmadan önce `pnpm lint`, `pnpm typecheck` ve `pnpm test` hatasız geçmelidir.

## Değiştirilemez kurallar
1. **Sunucu otoriterdir.** Doğru cevap, süre ve puan yalnızca `apps/realtime`'da tutulur. Doğru cevap istemciye `round:result` olayından önce asla gönderilmez. JSON'da doğru şık her zaman `answerIndex: 0`'dır; sunucu her soruyu göndermeden önce şıkları karıştırır.
2. **Event sözleşmesi tektir.** Socket event isimleri ve payload tipleri yalnızca `packages/shared/events.ts`'te tanımlanır; hem web hem realtime oradan import eder. Gelen her payload Zod ile doğrulanır.
3. **Bot yok.** Kullanıcıya rakip varmış gibi görünen hiçbir sahte oyuncu, sahte mesaj veya sahte sayı üretilmez. Online sayacı gerçek değeri gösterir.
4. **Eşleşme:** Bir kullanıcı engellediği/engelleyen kişilerle ve kendi cihazıyla eşleşmez. Rakip, uygun bekleyenler arasından rastgele seçilir; son 20 rakip kuralı şimdilik kapalıdır, `MATCH_AVOID_RECENT=true` ile açılır (SPEC §6).
5. **Kategori ve oyun tamamen rastgeledir**, kullanıcı seçemez (SPEC §7–8).
6. **Rastgele sohbet 7 dakikadır**, mesajları yalnızca Redis'te tutulur (TTL 24 saat) ve DM'e taşınmaz.
7. **DM mesajları 24 saat sonra silinir** (`Message.expiresAt`). Okuma sorguları da `expiresAt > now()` filtresi uygular.
8. **Link:** Rastgele sohbette link, e-posta, telefon ve `@kullanıcıadı` engellidir; arkadaşlar arası DM'de link serbesttir (SPEC §11).
9. Kelime listesi (`badwords.tr.txt`) yalnızca sunucuda yüklenir, istemci paketine girmez.
10. Kullanıcıdan serbest metin olarak takma ad alınmaz; takma ad ve avatar rastgele atanır (SPEC §4, §18).
11. Gizli değerler (`JWT_SECRET`, `DATABASE_URL`, `REDIS_URL`) yalnızca ortam değişkeninden okunur; repoya `.env` girmez, sadece `.env.example` girer.

## Kod kuralları
- Arayüz metinleri Türkçe; kod, değişken ve commit mesajları İngilizce.
- Mobil öncelikli tasarım: 360 px genişlikte kırılmadan çalışmalı, dokunma hedefleri en az 44 px.
- Tema rengi `#F8F6F1` (krem); renkler `apps/web/tailwind.config.ts` içinde token olarak tanımlanır.
- Her oyun motoru `apps/realtime/src/games/{engine}.ts` dosyasında, ortak `GameEngine` arayüzünü uygular ve kendi test dosyasına sahiptir.
- Yeni bağımlılık eklemeden önce gerekçesini PR açıklamasına yaz.

## İçerik
- Soru kaynakları `content/*.txt` içindedir; `packages/shared/content/questions.json` **üretilmiş dosyadır, elle düzenleme.**
- Satır biçimi (`|` ile ayrılır, her bölüm `# cat:<kategori_id>` ile başlar):
  - `M|soru|doğru|yanlış1|yanlış2|yanlış3` — çoktan seçmeli
  - `J|emojiler|doğru|yanlış1|yanlış2|yanlış3` — emoji tahmini
  - `T|ifade|1 veya 0` — doğru/yanlış
  - `E|soru|cevap|tolerans|birim` — yaklaşık tahmin
  - `A|seçenek A|seçenek B` — Ayna turu
  - `L|metin`, `P|metin`, `B|metin` — sohbet kartı (hafif / kişisel / cesaret)
- Kategori başına beklenen sayılar build script'inde kontrol edilir; sayı tutmazsa build hata verir.

## Avatarlar
- Ham görseller `apps/web/public/avatars/raw/{id}.png`. Liste ve renkler SPEC §18'de.
- Ham görsel yoksa geliştirme sırasında hayvanın yedek emojisi gösterilir; bu yüzden avatar işi diğer işleri bloklamaz.
