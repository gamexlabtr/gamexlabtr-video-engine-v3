# GamexlabTR Video Engine v5.1.0

GitHub Actions üzerinde çalışan otomatik oyun video motoru.

## v5.1 yenilikleri

- Her oyun aynı workflow içinde en fazla **2 kez** denenir.
- İki deneme de başarısızsa oyun WordPress kuyruğunda `failed` olarak raporlanır ve sistem sıradaki oyuna geçer.
- Tek workflow içinde en fazla **10 farklı aday oyun** denenir.
- İlk başarılı videoda çalışma durur ve artifact üretilir.
- Sağlayıcı profilleri, reklam güvenliği, START/PLAY doğrulaması ve gerçek oynanış kalite kapısı v5'ten korunur.
- Hata nedeni ve aynı çalışmadaki deneme sayısı WordPress Video Kuyruğu ekranına gönderilir.
- TR + EN açıklama, hashtag, intro/outro ve sosyal medya paketi korunur.

## GitHub Secrets

- `GXL_SITE_URL` = `https://gamexlabtr.com`
- `GXL_VIDEO_API_TOKEN` = WordPress GamexlabTR Core Video Otomasyonu tokenı
- `MAKE_WEBHOOK` = isteğe bağlı

## Çalışma mantığı

1. WordPress kuyruğundan videosu yapılmamış oyun alınır.
2. Oyun 1. kez denenir.
3. Başarısızsa tarayıcı/capture durumu sıfırlanır ve aynı oyun 2. kez denenir.
4. İkinci deneme de başarısızsa hata ve `2/2` bilgisi WordPress'e yazılır.
5. Sistem sıradaki oyuna geçer; en fazla 10 aday dener.
6. İlk kalite kontrolünden geçen video artifact olarak yüklenir.

## Kurulum

ZIP içindeki tüm dosyaları GitHub repo köküne kopyalayın, Replace All yapın, Commit ve Push edin. Actions > Create Game Video > Run workflow ile çalıştırın. Normal otomatik kullanımda manuel oyun alanlarını boş bırakın.
