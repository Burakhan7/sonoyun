import type { Metadata } from 'next';
import { LegalPage } from '@/components/LegalPage';
import { LEGAL } from '@/lib/legal';

export const metadata: Metadata = { title: 'Kullanım Koşulları' };

export default function TermsPage() {
  return (
    <LegalPage title="Kullanım Koşulları">
      <p>
        Son güncelleme: {LEGAL.updatedAt}. Hizmet sağlayıcı: {LEGAL.operator}, [adres]. İletişim:{' '}
        <a href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a>
      </p>

      <h2>1. Hizmet</h2>
      <p>
        Site, rastgele eşleşen iki kullanıcının kısa bir mini oyun oynamasını ve ardından 7 dakika
        yazışmasını sağlar. Karşılıklı kabul hâlinde kullanıcılar arkadaş olur ve özel
        mesajlaşabilir. Özel mesajlar gönderildikten 24 saat sonra silinir.
      </p>

      <h2>2. Yaş şartı</h2>
      <p>
        <strong>Site 18 yaşından küçükler tarafından kullanılamaz.</strong> Siteye girerek 18 yaşını
        doldurduğunu beyan edersin. Reşit olmadığı düşünülen kullanıcılar raporlanabilir; bu
        raporlar öncelikli incelenir.
      </p>

      <h2>3. Kurallar</h2>
      <ul>
        <li>Taciz, tehdit, küfür, nefret söylemi ve ayrımcılık yasaktır.</li>
        <li>Cinsel içerik paylaşmak ve başkalarını rahatsız etmek yasaktır.</li>
        <li>Rastgele sohbette link, e-posta, telefon ve kullanıcı adı paylaşılamaz.</li>
        <li>Başkasının kişisel bilgilerini paylaşmak yasaktır.</li>
        <li>Spam, dolandırıcılık ve hukuka aykırı her türlü kullanım yasaktır.</li>
        <li>
          Sistemi manipüle etmek, otomatik araç kullanmak ve kısıtları aşmaya çalışmak yasaktır.
        </li>
      </ul>

      <h2>4. Moderasyon</h2>
      <p>
        Mesajlar otomatik kelime filtresinden geçer. Kullanıcı güvenliğini sağlamak ve kötüye
        kullanımı önlemek için rastgele sohbetler, oyun sohbetleri ve özel mesajlar, silindikleri 24
        saate kadar yetkili moderatörler tarafından canlı veya sonradan incelenebilir. Kullanıcılar
        birbirini raporlayabilir ve engelleyebilir. Raporlanan görüşmenin son 50 mesajı inceleme
        için saklanır. 24 saat içinde 3 farklı kişiden rapor alan hesap otomatik olarak 24 saat
        eşleşmeye kapatılır. Kurallara uymayan hesaplar geçici veya kalıcı olarak kısıtlanabilir.
      </p>

      <h2>5. Kullanıcı içeriği ve sorumluluk</h2>
      <p>
        Yazdığın içerikten sen sorumlusun. Diğer kullanıcıların içerikleri onların
        sorumluluğundadır. Hizmet olduğu gibi sunulur; kesintisiz çalışacağı garanti edilmez.
      </p>

      <h2>6. Hesap</h2>
      <p>
        Hesaplar misafir ve cihaz bazlıdır. Hesabını Ayarlar sayfasından başka cihaza taşıyabilir
        veya silebilirsin.
      </p>

      <h2>7. Değişiklikler ve uygulanacak hukuk</h2>
      <p>
        Koşullar güncellenebilir. Uyuşmazlıklarda Türk hukuku uygulanır; yetkili merci: [mahkeme ve
        icra daireleri].
      </p>
    </LegalPage>
  );
}
