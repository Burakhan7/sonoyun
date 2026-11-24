# Ertelenen işler ve öneriler

Zamanı gelince yapılacak işler. Yapılan madde bu listeden silinir. Yayın adımlarının tamamı [README](../README.md) içindeki lansman kontrol listesindedir.

## Yayından önce zorunlu
- [ ] Kullanım Koşulları, Gizlilik ve KVKK şablonlarını **hukukçuya onaylat**, köşeli parantezleri doldur, `LegalPage.tsx` içindeki şablon uyarısını kaldır.
- [ ] 5651 kayıtlarının kapsamını ve saklama süresini netleştir (SPEC §15 [KARAR]), sonra silme işini ekle. **Şu an `AccessLog` hiç silinmiyor.**
- [ ] 5651 kayıtları artık IP, kaynak port ve zamanı içeriyor (Caddy portu iletiyor). Bunun yeterliliğini hukukçuya sor.
- [ ] Silinen hesaplara ait rapor kayıtlarının saklama süresini belirle. Şu an kanıt olarak süresiz tutuluyor.
- [ ] Yurt dışı veri aktarımı (Hetzner, Almanya; kullanılırsa Sentry ve Plausible) için KVKK m.9 dayanağını belirle. Hukukçu sorun görürse aynı kurulum bir Türk sağlayıcıya taşınabilir.
- [ ] `apps/realtime/badwords.tr.txt` kelime listesini doldur. **Liste boşken küfür maskeleme çalışmaz.**
- [ ] Alan adını al, Hetzner sunucusunu README'deki gibi kur.
- [ ] Yük testini staging ortamında tekrarla. Yerel test Docker ağında yapıldı, gerçek ağ gecikmesini içermiyor.

## Ürün kararları
- [ ] Cihaz özeti toplanıyor ve Gizlilik/KVKK metnine yazıldı. Hukukçuya sor: meşru menfaat yeterli mi, yoksa çerez bandında ayrı onay mı gerekir?
- [ ] Slogan geçici: "Yabancıyla buz, bir oyunda kırılır." Nihai metni belirle.
- [ ] Çalışma adı yerine nihai ürün adı ve logoyu belirle.
- [ ] Arkadaşlar arası oyun sohbetinde link şimdilik rastgele sohbetteki gibi engelli; DM gibi serbest olsun mu kararlaştır.

## Ölçek
- [ ] Oyun durumu realtime sürecinin belleğinde. Birden fazla instance'a çıkmadan önce sticky session ekle; aksi halde yeniden bağlanan oyuncu oyununa dönemez. Lansmanda tek instance çalıştır.
- [ ] 500 eşzamanlı kullanıcıda tek süreç yaklaşık bir CPU çekirdeğini dolduruyor (tepe %93). Bu seviyeye yaklaşmadan yatay ölçeklemeyi hazırla.
- [ ] Realtime yeniden başlarsa canlı oyunlar kaybolur ve oyuncular "oyun sona erdi" görür. Deploy'lar için kademeli kapanış planla.
- [ ] Realtime Docker imajı 1,1 GB. Üretim bağımlılıklarını `pnpm deploy` ile ayırarak küçült.

## Küçük iyileştirmeler
- [ ] Oyun veya sohbet sırasında gelen oyun davetleri gösterilmiyor ve 1 dakikada düşüyor; davet edene "arkadaşın şu an oyunda" bilgisi ver.
- [ ] Kart seçimi ekranında sunucudan gelen hata mesajları gösterilmiyor; `CardPicker` içine bildirim alanı ekle.
- [ ] Sohbette 1 mesaj/sn sınırına takılan kullanıcı için butonda kısa bir bekleme göstergesi ekle.
- [ ] Repodaki Playwright testini admin, DM ve davet akışlarını kapsayacak şekilde genişlet.
- [ ] Admin panelinde raporlanan kullanıcının yanında aynı cihaz özeti ve IP'den açılmış diğer hesapları göster (ban kaçırma sinyali). Aynı model telefonlar aynı özeti üretebildiği için otomatik ban yapma.

## Bakım
- [ ] ESLint 9 kullanımdan kalkıyor; uygun bir zamanda ESLint 10'a geç.
- [ ] Prisma 6'dan yeni major sürüme geçişi değerlendir.
