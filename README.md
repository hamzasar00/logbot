# Discord Log Bot

Bu proje, ayrı ayrı açılıp kapatılabilen otomatik Discord log sistemi içerir.

## Özellikler

- `.setup` komutuyla otomatik kullanıcı, mesaj, rol, kanal, ses, moderasyon ve sunucu log kanalları oluşturulur.
- Her log türü için ayrı kanal ve bağımsız aktif/pasif durumu vardır.
- `.log` komutuyla sade bir kontrol paneli açılır.
- Olaylar otomatik olarak tespit edilir ve ilgili log kanalına embed olarak gönderilir.
- Tüm kullanıcı mesajları Türkçe olarak hazırlanır.
- Prefix sadece `.` kullanılır.
- Veritabanı ayarları taşınabilir JSON dosyasında saklanır; Python veya Visual Studio gerekmez.

## Windows'ta kurulum

> Node.js **22 LTS veya 24 LTS** kullanmanız önerilir.

1. Projenin tamamını ZIP'ten çıkarın. ZIP dosyasının içindeki eski `proje.zip` dosyasını çalıştırmayın.
2. [Node.js LTS](https://nodejs.org/) sürümünü kurun.
3. Proje klasöründe **kurulum.bat** dosyasına çift tıklayın. Bağımlılıkları kurar ve yoksa `.env` dosyasını oluşturur.
4. Oluşan **.env** dosyasını Not Defteri ile açıp Discord bot bilgilerinizi yazın:

   ```env
   DISCORD_TOKEN=YOUR_BOT_TOKEN
   CLIENT_ID=YOUR_CLIENT_ID
   GUILD_ID=YOUR_TEST_GUILD_ID
   ```

5. **baslat.bat** dosyasına çift tıklayın.

### Komut satırından kurulum

PowerShell veya Git Bash'te proje klasöründe:

```bash
rm -rf node_modules
npm install
cp .env.example .env
npm start
```

Windows Komut İstemi'nde `rm -rf node_modules` yerine `rmdir /s /q node_modules`, `cp` yerine `copy` kullanın.

## Komutlar

- `.setup` → Tüm log kategorilerini ve kanalları oluşturur.
- `.log` → Log açık/kapalı kontrol panelini gösterir.
- `.oda` → Özel ses odası menüsünü hazırlar.

## Sık karşılaşılan hatalar

- **DISCORD_TOKEN bulunamadı:** Proje klasöründe `.env` dosyası olduğundan ve token satırının doldurulduğundan emin olun.
- **Invalid token:** Discord Developer Portal'dan bot tokenını yenileyip `.env` içindeki değeri güncelleyin.
- **Intent hatası:** Developer Portal > Bot > Privileged Gateway Intents bölümünde gerekli intentleri açın.
- **Eski better-sqlite3/node-gyp hatası:** Eski `node_modules` klasörünü silip `npm install` çalıştırın. Güncel sürümde bu native bağımlılık artık kullanılmıyor.

## Not

Bu proje yerel geliştirme için tasarlanmıştır. Gerçek Discord sunucusunda kullanılmadan önce botunuzun gerekli Gateway intent izinlerine sahip olduğundan emin olun.
