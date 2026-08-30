# Discord Log Bot

Bu proje, ayrı ayrı açılıp kapatılabilen, otomatik Discord log sistemi içerir.

## Özellikler

- `.setup` komutuyla otomatik kullanıcı, mesaj, rol, kanal, ses, moderasyon ve sunucu log kanalları oluşturulur.
- Her log türü için ayrı kanal ve bağımsız aktif/pasif durumu vardır.
- `.log` komutuyla sade bir kontrol paneli açılır.
- Olaylar otomatik olarak tespit edilir ve ilgili log kanalına embed olarak gönderilir.
- Tüm kullanıcı mesajları Türkçe olarak hazırlanır.
- Prefix sadece `.` kullanılır.

## Kurulum

1. Bağımlılıkları kur:
   ```bash
   npm install
   ```
2. `.env.example` dosyasını `.env` olarak kopyalayın:
   ```bash
   cp .env.example .env
   ```
3. `.env` dosyasına Discord bot bilgilerinizi yazın:
   ```env
   DISCORD_TOKEN=YOUR_BOT_TOKEN
   CLIENT_ID=YOUR_CLIENT_ID
   GUILD_ID=YOUR_TEST_GUILD_ID
   ```
4. Botu başlatın:
   ```bash
   npm start
   ```

## Komutlar

- `.setup` → Tüm log kategorilerini ve kanallarını oluşturur.
- `.log` → Log açık/kapalı kontrol panelini gösterir.

## Not

Bu proje yerel geliştirme için tasarlanmıştır. Gerçek Discord sunucusunda kullanılmadan önce botunuzun gerekli Gateway intent izinlerine sahip olduğundan emin olun.
