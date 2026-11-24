import type { Metadata } from 'next';
import { LegalPage } from '@/components/LegalPage';
import { LEGAL } from '@/lib/legal';

export const metadata: Metadata = { title: 'Gizlilik' };

export default function PrivacyPage() {
  return (
    <LegalPage title="Gizlilik Politikası">
      <p>
        Son güncelleme: {LEGAL.updatedAt}. Veri sorumlusu: {LEGAL.operator}, [adres]. İletişim:{' '}
        <a href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a>
      </p>

      <h2>Hangi verileri işliyoruz?</h2>
      <ul>
        <li>Hesap: rastgele takma ad, avatar, oluşturma ve son görülme zamanı, kural onayı.</li>
        <li>Bağlantı kayıtları: IP adresi, varsa port, olay türü ve zaman damgası.</li>
        <li>
          Cihaz özeti: tarayıcı sürümü, dil, saat dilimi, ekran boyutu ve ekran kartı gibi genel
          özelliklerden tarayıcında üretilen, geri çevrilemeyen bir özet. Aynı ağdaki farklı
          kişileri ayırt etmek, kişinin kendisiyle eşleşmesini ve ban kaçırmayı önlemek için
          kullanılır. Cihazında hiçbir şey saklanmaz.
        </li>
        <li>Oyun: eşleşmeler, kategori, skor, görülen soru kimlikleri.</li>
        <li>Sosyal: arkadaşlıklar, istekler, engellemeler.</li>
        <li>Mesajlar: rastgele sohbet ve özel mesajlar.</li>
        <li>Raporlar: rapor nedeni, not ve raporlanan görüşmenin son 50 mesajı.</li>
        <li>Hata kayıtları: kullanıcı kimliği ve mesaj içeriği olmadan teknik hata bilgisi.</li>
      </ul>

      <h2>Ne kadar saklıyoruz?</h2>
      <ul>
        <li>Rastgele sohbet mesajları: 24 saat.</li>
        <li>Özel mesajlar: gönderildikten 24 saat sonra silinir.</li>
        <li>Hesap verileri: hesabını silene kadar.</li>
        <li>Bağlantı kayıtları: [5651 sayılı Kanun kapsamındaki süre, hukukçu teyidiyle].</li>
        <li>Raporlar: [inceleme ve hukuki yükümlülükler için belirlenecek süre].</li>
      </ul>

      <h2>Çerezler ve tarayıcı depolama</h2>
      <ul>
        <li>
          <strong>Zorunlu:</strong> oturum çerezi ve tarayıcıda saklanan oturum anahtarı; misafir
          hesabının çalışması için gereklidir.
        </li>
        <li>
          <strong>Analitik (isteğe bağlı):</strong> yalnızca onay verirsen yüklenir. Onayını çerez
          bandından verebilir veya reddedebilirsin.
        </li>
      </ul>

      <h2>Kimlerle paylaşıyoruz?</h2>
      <p>
        Site ve tüm veriler, barındırma sağlayıcısı Hetzner Online GmbH’nin Almanya’daki
        sunucularında tutulur. Aktarım dayanağı: [KVKK m.9 kapsamındaki dayanak]. Yetkili kurumların
        hukuka uygun talepleri hâlinde veriler paylaşılabilir. Verilerin satılması söz konusu
        değildir.
      </p>

      <h2>Hesabını silme</h2>
      <p>
        Ayarlar → Hesabımı sil ile hesabın, arkadaşlıkların, özel mesajların ve eşleşme listelerin
        silinir; oyun istatistikleri anonimleştirilir. Bağlantı kayıtları yasal süre boyunca, rapor
        kayıtları ise yukarıda belirtilen süre boyunca saklanır.
      </p>

      <h2>İletişim</h2>
      <p>
        Sorularını <a href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a> adresine iletebilirsin.
      </p>
    </LegalPage>
  );
}
