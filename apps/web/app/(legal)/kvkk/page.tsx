import type { Metadata } from 'next';
import { LegalPage } from '@/components/LegalPage';
import { LEGAL } from '@/lib/legal';

export const metadata: Metadata = { title: 'KVKK Aydınlatma Metni' };

export default function KvkkPage() {
  return (
    <LegalPage title="KVKK Aydınlatma Metni">
      <p>
        6698 sayılı Kişisel Verilerin Korunması Kanunu’nun 10. maddesi uyarınca veri sorumlusu
        sıfatıyla {LEGAL.operator} ([MERSİS veya vergi no], [adres]) tarafından bilgilendirilirsin.
        Son güncelleme: {LEGAL.updatedAt}.
      </p>

      <h2>1. İşlenen kişisel veriler</h2>
      <p>
        Takma ad ve avatar; IP adresi, port ve zaman damgası; tarayıcı özelliklerinden üretilen
        cihaz özeti; oyun ve eşleşme kayıtları; arkadaşlık ve engelleme bilgileri; mesaj içerikleri;
        rapor kayıtları.
      </p>

      <h2>2. İşleme amaçları</h2>
      <ul>
        <li>Oyun, eşleşme, sohbet ve arkadaşlık hizmetlerinin sunulması</li>
        <li>Kötüye kullanımın önlenmesi, raporların incelenmesi ve kullanıcı güvenliği</li>
        <li>5651 sayılı Kanun ve diğer mevzuattan doğan yükümlülüklerin yerine getirilmesi</li>
        <li>Teknik hataların giderilmesi ve hizmetin geliştirilmesi</li>
      </ul>

      <h2>3. Hukuki sebepler</h2>
      <p>
        [KVKK m.5/2 kapsamında sözleşmenin ifası, hukuki yükümlülük, meşru menfaat ve analitik için
        açık rıza; hukukçu tarafından her işleme amacıyla eşleştirilecektir.]
      </p>

      <h2>4. Aktarım</h2>
      <p>
        Kişisel veriler; barındırma sağlayıcısı Hetzner Online GmbH’ye (Almanya) ve yetkili kamu
        kurumlarına aktarılabilir. Yurt dışına aktarım KVKK m.9 kapsamında [aktarım dayanağı] ile
        yapılır.
      </p>

      <h2>5. Toplama yöntemi</h2>
      <p>Veriler, siteyi kullandığında elektronik ortamda otomatik yollarla toplanır.</p>

      <h2>6. Saklama süresi</h2>
      <p>
        Veriler Gizlilik Politikası’nda belirtilen süreler boyunca saklanır, süre sonunda silinir,
        yok edilir veya anonim hâle getirilir.
      </p>

      <h2>7. Haklarınız (KVKK m.11)</h2>
      <ul>
        <li>Verilerinin işlenip işlenmediğini öğrenme ve bilgi talep etme</li>
        <li>İşleme amacını ve amaca uygun kullanılıp kullanılmadığını öğrenme</li>
        <li>Aktarıldığı üçüncü kişileri bilme</li>
        <li>Eksik veya yanlış işlenmişse düzeltilmesini isteme</li>
        <li>Silinmesini veya yok edilmesini isteme</li>
        <li>Otomatik analiz sonucu aleyhine çıkan sonuca itiraz etme</li>
        <li>Kanuna aykırı işleme nedeniyle zararın giderilmesini talep etme</li>
      </ul>
      <p>
        Başvurularını <a href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a> adresine e-posta ile veya
        [adres] adresine yazılı olarak iletebilirsin. Başvurular en geç 30 gün içinde ücretsiz
        yanıtlanır.
      </p>
    </LegalPage>
  );
}
