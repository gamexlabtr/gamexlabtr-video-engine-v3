# GamexlabTR Video Engine v5.0.0

GitHub Actions üzerinde çalışan otomatik oyun video motoru.

## v5 yenilikleri

- Sağlayıcı profilleri: GameMonetize, GamePix, Playgama, GameDistribution, CrazyGames ve fallback profil.
- Provider bazlı yükleme/START bekleme süreleri ve güvenli başlangıç noktaları.
- Reklam/yönlendirme sinyali varken oynanışı başlatmama.
- Yalnız tespit edilen oyun yüzeyinin güvenli merkez alanında etkileşim.
- Kategoriye göre giriş davranışı: yarış, aksiyon/platform, bulmaca, spor ve karma.
- START/PLAY görünürken gerçek oynanış kabul etmeme.
- Görsel hareket doğrulamasıyla gerçek oynanış başlangıcını doğrulama.
- Temiz oynanış segmentlerini kaydetme; reklam/redirect dönemlerini final videodan çıkarma.
- FFmpeg tabanlı kalite kapısı: blank/static/loading benzeri videoları reddeder.
- Başarısız oyunda aynı çalışmada sıradaki adaya geçer (`MAX_CANDIDATES_PER_RUN`, varsayılan 3).
- Her çalışmada `output/quality.json` ve `output/analytics/*.json*` üretir.
- TR + EN açıklama, hashtag, intro/outro ve sosyal medya paketi korunur.

## GitHub Secrets

- `GXL_SITE_URL` = `https://gamexlabtr.com`
- `GXL_VIDEO_API_TOKEN` = WordPress GamexlabTR Core Video Otomasyonu tokenı
- `MAKE_WEBHOOK` = isteğe bağlı

## Kurulum

1. ZIP içeriğini GitHub repo köküne kopyalayın ve mevcut dosyaların üzerine yazın.
2. GitHub Desktop: Commit -> Push origin.
3. Actions -> Create Game Video -> Run workflow.
4. Normal otomatik kullanımda manuel oyun alanlarını boş bırakın.

## Çıktılar

- `output/gamexlabtr-final.mp4`
- `output/cover.png`
- `output/metadata.json`
- `output/social.json`
- `output/selection.json`
- `output/quality.json`
- `output/analytics/latest.json`
- `output/analytics/video-engine.jsonl`

## Not

v5 reklamları tıklamaya çalışmaz. Yalnız açıkça `Skip/Close/Continue` anlamına gelen güvenli kontrolleri kullanır. Oynanış kalite kontrolünden geçmezse video paylaşım için başarılı sayılmaz.
