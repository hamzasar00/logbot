# Discord Log Bot

Bu proje, ayrı ayrı açılıp kapatılabilen otomatik Discord log sistemi içerir.

## Özellikler

- `.setup` komutuyla otomatik kullanıcı, mesaj, rol, kanal, ses, moderasyon ve sunucu log kanalları oluşturulur.
- Her log türü için ayrı kanal ve bağımsız aktif/pasif durumu vardır.
- `.log` komutuyla sade bir kontrol paneli açılır.
- Olaylar otomatik olarak tespit edilir ve ilgili log kanalına embed olarak gönderilir.
- Tüm kullanıcı mesajları Türkçe olarak hazırlanır.
- Prefix sadece `.` kullanılır.

## Windows'ta kurulum

> En sorunsuz seçenek Node.js **22 LTS veya 24 LTS** kullanmaktır. Bu proje Node.js 22-24 aralığını destekler.

1. Projenin tamamını ZIP'ten çıkarın. ZIP dosyasının içindeki ZIP'i çalıştırmayın.
2. [Node.js LTS](https://nodejs.org/) sürümünü kurun.
3. Proje klasöründe **kurulum.bat** dosyasına çift tıklayın. Bu dosya bağımlılıkları kurar ve yoksa `.env` dosyasını oluşturur.
4. Oluşan **.env** dosyasını Not Defteri ile açıp Discord bot bilgilerinizi yazın:

   ```env
   DISCORD_TOKEN=YOUR_BOT_TOKEN
   CLIENT_ID=YOUR_CLIENT_ID
   GUILD_ID=YOUR_TEST_GUILD_ID
   ```

5. **baslat.bat** dosyasına çift tıklayın.

### Komut satırından kurulum

PowerShell veya Komut İstemi'nde proje klasöründe:

```bash
npm install
copy .env.example .env
npm start
```

PowerShell'de `copy` yerine `Copy-Item .env.example .env` kullanabilirsiniz.

## Komutlar

- `.setup` → Tüm log kategorilerini ve kanalları oluşturur.
- `.log` → Log açık/kapalı kontrol panelini gösterir.

## Sık karşılaşılan hatalar

- **better-sqlite3 yüklenemedi:** Node.js 22 veya 24 LTS kurup proje klasöründe tekrar `npm install` çalıştırın.
- **DISCORD_TOKEN bulunamadı:** Proje klasöründe `.env` dosyası olduğundan ve token satırının doldurulduğundan emin olun.
- **Invalid token:** Discord Developer Portal'dan bot tokenını yenileyip `.env` içindeki değeri güncelleyin.
- **Intent hatası:** Developer Portal > Bot > Privileged Gateway Intents bölümünde gerekli intentleri açın.

## Not

Bu proje yerel geliştirme için tasarlanmıştır. Gerçek Discord sunucusunda kullanılmadan önce botunuzun gerekli Gateway intent izinlerine sahip olduğundan emin olun.
