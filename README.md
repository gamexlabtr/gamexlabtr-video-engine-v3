# GamexlabTR Video Engine v4.0.0

V4 direct game/embed capture engine. It does not accept a visible canvas as gameplay by itself: ads and START/PLAY states are waited out, visual activity is verified, and only clean gameplay segments are rendered into the final social video.

# GamexlabTR Video Engine v3.1 FINAL

Tam otomatik GitHub Actions video motoru. Normal kullanımda oyun URL'si girilmez. WordPress/GamexlabTR Core sıradaki videosu olmayan oyunu seçer; motor gerçek embed/iframe hedefini bulur, oynanışı kaydeder, boş video kontrolü yapar, 1080x1920 MP4 üretir ve TR+EN sosyal medya paketini hazırlar.

## Tek seferlik kurulum

1. WordPress'e **GamexlabTR Core v13.3.0 Video Automation** yükle/etkinleştir.
2. WordPress → **GamexlabTR Core → Video Otomasyonu** ekranını aç.
3. GitHub repository → **Settings → Secrets and variables → Actions** altında:
   - `GXL_SITE_URL` = `https://gamexlabtr.com`
   - `GXL_VIDEO_API_TOKEN` = WordPress ekranındaki anahtar
   - `MAKE_WEBHOOK` = opsiyonel; Make'e video hazır bildirimi göndermek için webhook
4. Bu ZIP'in içeriğini GitHub reposunun köküne yükle ve eski dosyaların üzerine yaz.
5. GitHub Actions → **Create Game Video** → Run workflow. Normal kullanımda `game_url` boş kalır.

## Ne otomatik?

- Videosu tamamlanmamış sıradaki oyunu seçer.
- WordPress'ten oyun adı, kategori, sağlayıcı, sayfa URL'si ve embed URL'sini alır.
- GameMonetize, GamePix, Playgama ve diğer iframe/provider adreslerini çözmeye çalışır.
- Play/Start/Oyna/canvas etkileşimlerini dener.
- 8-60 sn Playwright kaydı alır (varsayılan 30 sn).
- Kayıt çoğunlukla beyaz/siyahsa reddeder.
- Bir aday başarısızsa WordPress'e `fail` bildirir ve aynı GitHub çalışmasında sıradaki oyunu dener (en fazla 3 aday).
- Başarılı oyunu WordPress'te `complete` işaretler; aynı oyun yeniden seçilmez.
- 1080x1920 `gamexlabtr-final.mp4` üretir.
- Kapanış ekranında Türkçe + İngilizce takip çağrısı gösterir.
- `social.json` içinde aynı açıklamada Türkçe + English metin, otomatik oyun/kategori/sağlayıcı hashtagleri ve YouTube/Instagram/Facebook/TikTok alanları üretir.
- Artifact hazır olduktan sonra opsiyonel Make webhook'unu bildirir.

## Make'ten tetikleme

Make'in GitHub workflow_dispatch body örneği:

```json
{
  "ref": "main",
  "inputs": {
    "game_url": "",
    "game_embed_url": "",
    "game_title": "",
    "category": "",
    "provider": "",
    "record_seconds": "30",
    "make_webhook": ""
  }
}
```

Oyun seçimini Make değil WordPress Video Queue yapar.

## Çıktılar

- `output/gamexlabtr-final.mp4`
- `output/cover.png`
- `output/metadata.json`
- `output/social.json`
- `output/selection.json`

## Sosyal açıklama

`social.json` tek paylaşım açıklamasında önce Türkçe, sonra İngilizce metin üretir. Her iki dilde de beğeni/takip çağrısı bulunur. `HTML5` ifadesi kullanılmaz.

## Önemli

Video motoru paylaşım metinlerini ve dosyayı hazırlar. Facebook/Instagram/YouTube/TikTok'a gerçek yükleme için ilgili platform bağlantısı/izinleri Make tarafında ayrıca tanımlanmalıdır; repo gizli erişim anahtarlarını kendi içine gömmez.


## v3.1.1 Ad-safe capture

- Blocks/recovers unexpected ad redirects and closes popup tabs.
- Gameplay clicks are constrained to the detected game surface.
- Safe Skip/Close controls are used when detected; ad content itself is not clicked.
- `capture.js` stores `gameplayStartOffsetSeconds` in `output/metadata.json`.
- `render.sh` automatically trims provider ads/loaders before composing the final vertical video.
- Video validation samples the clean gameplay window after the trim point.
