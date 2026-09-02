# Discord Log Bot

Discord sunucuları için Türkçe çalışan, otomatik log, boost bildirimi, rol seçim menüsü ve özel ses odası botu.

## Özellikler

- Üye, mesaj, rol, kanal, ses, moderasyon, sunucu ve boost olaylarını ayrı kanallara loglar.
- Her log türü bağımsız olarak açılıp kapatılabilir.
- Log kanalları seçim menüsü ile değiştirilebilir.
- Boost geldiğinde kişiye özel avatar, başlık, mesaj ve GIF içeren bildirim gönderir.
- Üyeler dropdown menüsünden yalnızca rol alabilir; menü üzerinden rol kaldırma yoktur.
- Roller Etkinlik, Renk, Burç, Oyun, Takım ve Diğer kategorilerinde gösterilir.
- Üyelere özel geçici ses odaları oluşturur ve oda sahibi ayrılınca odayı kapatır.
- Ayarlar JSON dosyalarında saklanır; bot yeniden başlatıldığında mevcut kanalları yeniden kullanır.
- Tüm prefix komutları nokta ile başlar: .

## Gereksinimler

- Node.js 22 LTS veya 24 LTS
- Discord bot tokenı
- Botun sunucuda gerekli izinleri
- Bot rolünün, dağıtacağı rollerin üzerinde bulunması

## Windows kurulumu

1. Projeyi ZIP'ten çıkar.
2. Node.js LTS kur: https://nodejs.org/
3. Proje klasöründe kurulum.bat dosyasını çalıştır veya aşağıdaki komutları kullan.
4. .env dosyasını oluştur ve Discord bot tokenını gir.
5. baslat.bat dosyasını çalıştır.

~~~env
DISCORD_TOKEN=YOUR_BOT_TOKEN
CLIENT_ID=YOUR_CLIENT_ID
GUILD_ID=YOUR_TEST_GUILD_ID
~~~

Komut satırından:

~~~bash
npm install
npm start
~~~

Tokenı GitHub'a veya herkese açık bir dosyaya kesinlikle eklemeyin.

## Discord Developer Portal ayarları

Bot > Privileged Gateway Intents bölümünde kullanılan intentleri aç:

- Server Members Intent
- Message Content Intent
- Server Presence Intent gerekiyorsa etkinleştir

Botun log ve bildirim kanallarında şu izinleri olmalı:

- Kanalları Görüntüle
- Mesaj Gönder
- Mesaj Geçmişini Görüntüle
- Embed Links
- Dosya ekle gerekiyorsa GIF dosyasına erişim
- Rol verecekse Rolleri Yönet

Botun en yüksek rolü, menüden verilecek rollerin üstünde olmalıdır.

## İlk kurulum

Sunucuda yönetici olarak:

~~~text
.setup
~~~

Bu komut LOGLAR kategorisini ve şu kanalları hazırlar:

- uye-log
- mesaj-log
- rol-log
- kanal-log
- ses-log
- moderasyon-log
- sunucu-log
- boost-log

Ayrıca oda ve rol menüsü altyapısını kontrol eder.

## Tüm komutlar

### Genel ve log komutları

#### .setup

Temel log kategorisini ve kanallarını oluşturur veya mevcut kanalları kullanır.

#### .log

Log kontrol panelini açar. Her log türünü ayrı ayrı açıp kapatabilir ve log kanalını değiştirebilirsin.

Log türleri:

- Üye: giriş, çıkış ve profil değişiklikleri
- Mesaj: mesaj silme, düzenleme ve toplu silme
- Rol: rol verme ve rol alma
- Kanal: kanal oluşturma, silme ve düzenleme
- Ses: ses kanalına giriş, çıkış ve taşıma
- Moderasyon: timeout ve ban işlemleri
- Sunucu: sunucu ayar değişiklikleri
- Boost: yeni boost başlangıçları

### Boost bildirimleri

Boost bildiriminin gideceği kanalı seç:

~~~text
.boost-kanal #boost
~~~

Boost mesajında gösterilecek GIF'i URL ile ayarla:

~~~text
.boost-gif https://ornek-site.com/dosya.gif
~~~

Alternatif olarak GIF dosyasını mesaja ekleyip sadece .boost-gif yazabilirsin. GIF'i kaldır:

~~~text
.boost-gif kaldır
~~~

Boost embed başlığını ayarla:

~~~text
.boost-baslik Thank You Buddy
~~~

Boost embed mesajını ayarla. Dikey çizgi yeni satır oluşturur:

~~~text
.boost-mesaj Welcome To Real CLR LEAK | LEAK Buddy
~~~

Boost bildirimi, boost başladığı anda seçilen kanala gönderilir. GIF için sayfa linki değil, doğrudan GIF veya medya CDN bağlantısı kullanılması gerekir.

Boost ayarları için Sunucuyu Yönet veya Kanalları Yönet izni gerekir.

### Rol menüsü

Rol menüsünü hazırla veya yenile:

~~~text
.roller
~~~

Alternatif hazırlama komutu:

~~~text
.roller-menu
~~~

Bot, kategori olmadan rol-menusu adlı bağımsız bir kanal kullanır. Üyeler dropdown menülerden rol seçebilir ve rol alabilir. Menü üzerinden rol kaldırma sistemi yoktur.

Role menüye ekleme:

~~~text
.roller-ekle @Oyuncu oyun
~~~

Kısa komut:

~~~text
.rol-ekle @Oyuncu oyun
~~~

Kategoriler:

- etkinlik — 🎉
- renk — 🎨
- burç — ⭐
- oyun — 🎮
- takım — ⚽
- kategori yazılmazsa — Diğer

Eski emoji yazmalı kullanım da desteklenir:

~~~text
.roller-ekle @Oyuncu 🎮 oyun
~~~

Rolü menüden kaldırma:

~~~text
.roller-sil @Oyuncu
~~~

Bu komut rolü sunucudan silmez; yalnızca seçim menüsünden çıkarır. Rol ekleme ve silme komutları için Rolleri Yönet izni gerekir.

### Özel ses odası

Oda menüsünü hazırla:

~~~text
.oda
~~~

Üye paneldeki butonla özel ses odası oluşturabilir. Oda sahibi, açılan yönetim menüsünden kullanıcı ekleyebilir veya çıkarabilir. Oda sahibi sunucudan ayrıldığında özel oda otomatik kapanır.

Desteklenen oda komutları:

- .oda-devret @kullanıcı — Oda sahipliğini devreder.
- .oda-kilitle — Odaya yeni girişleri kilitler.
- .oda-limit 10 — Oda kullanıcı limitini ayarlar. 0 sınırsızdır.

### Moderasyon

- .uyar @kullanıcı sebep — Kullanıcıya uyarı verir.
- .uyarilar @kullanıcı — Kullanıcının uyarılarını gösterir.
- .uyari-sil @kullanıcı — Uyarıları siler.
- .filtre ac veya .filtre kapat — Otomatik moderasyonu açar/kapatır.
- .filtre spam ac — Spam filtresini açar.
- .filtre link ac — Link filtresini açar.
- .filtre caps ac — Büyük harf filtresini açar.
- .filtre invite ac — Davet linki filtresini açar.
- .filtre kelime-ekle kelime — Yasaklı kelime ekler.
- .filtre kelime-sil kelime — Yasaklı kelimeyi kaldırır.

Filtreler gerektiğinde mesaj silebilir, uyarı verebilir ve uyarı sınırında timeout uygulayabilir.

### Hoş geldin ve otomatik rol

- .hosgeldin ac #kanal mesaj — Hoş geldin mesajını açar.
- .hosgeldin ayril #kanal mesaj — Ayrılma mesajını ayarlar.
- .hosgeldin rol @rol — Yeni üyeye otomatik rol verir.
- .hosgeldin durum — Mevcut ayarları gösterir.
- .hosgeldin kapat — Hoş geldin sistemini kapatır.
- .hosgeldin ayril-kapat — Ayrılma mesajını kapatır.
- .hosgeldin rol-kapat — Otomatik rolü kapatır.

Mesaj değişkenleri:

- {user}
- {username}
- {server}
- {count}

### İstatistik ve slash komutları

- .istatistik ac — İstatistik sistemini açar.
- .istatistik kapat — İstatistik sistemini kapatır.
- .istatistik — İstatistik ayarlarını gösterir.

Desteklenen slash komutları sunucuya otomatik kaydedilebilir:

- /uyar
- /filtre
- /hosgeldin
- /istatistik
- /oda-devret
- /oda-kilitle
- /oda-limit

### Seviye ve ödül sistemi

Seviye sistemi varsayılan olarak kapalıdır. Yönetici şu komutla açabilir:

~~~text
.seviye ac
~~~

- Mesajlardan cooldown kontrollü XP kazanılır.
- `.seviye` veya /seviye kullanıcı profilini gösterir.
- `.seviye sıralama` veya /seviye-siralama XP sıralamasını gösterir.
- `.seviye ayar xp 15` mesaj başına XP miktarını ayarlar.
- `.seviye ayar cooldown 60` XP kazanma aralığını saniye cinsinden ayarlar.
- `.seviye ayar duyuru #kanal` seviye atlama duyurularını belirli kanala gönderir.
- `.seviye ödül 5 @Rol` 5. seviyeye ulaşana rol verir.
- `.seviye ödül-sil 5` seviye ödülünü kaldırır.
- Veriler sunucu bazında V2 JSON dosyasında saklanır.
- .leaderboard kur #kanal sabit leaderboard panelini oluşturur.
- .leaderboard yenile paneli anında günceller.
- .leaderboard kapat otomatik güncellemeyi durdurur.
- Panel XP, seviye, mesaj, ses dakikası ve davet istatistiklerini gösterir.
- Panel her 60 saniyede bir otomatik yenilenir.
- /leaderboard-panel ile panel yönetilebilir.

### Yardım

Aşağıdaki komutların hepsi yardım menüsünü açar:

~~~text
.help
.yardım
.yardim
~~~

## Kanal yapısı

Botun oluşturduğu ana yapılar:

- LOGLAR kategorisi: log kanalları
- boost-log: varsayılan boost bildirim kanalı
- rol-menusu: bağımsız rol seçim kanalı, kategoriye bağlı değildir
- oda-menusu: özel ses odası oluşturma paneli
- Kullanıcı özel ses odaları: oda sahibine göre oluşturulan geçici kanallar

Bot yeniden başlatıldığında kayıtlı kanal ID'lerini ve kanal adlarını kontrol eder. Kanal hâlâ varsa yeni kanal oluşturmaz.

## Veri ve ayarlar

Ayarlar data/bot-data.json dosyasında saklanır. Bu dosya:

- log kanal ID'lerini
- log açık/kapalı durumlarını
- rol menüsü rollerini ve kategorilerini
- rol menüsü mesajını
- boost kanalı, GIF, başlık ve mesaj ayarlarını
- diğer sunucu ayarlarını

tutar.

.env ve data klasörü Git'e gönderilmemelidir. Sunucu veya hosting ortamı data klasörünü silerek yeniden başlatıyorsa ayarlar kaybolabilir; kalıcı disk veya veritabanı kullanılmalıdır.

## Sorun giderme

### Bot açılmıyor

- .env içindeki DISCORD_TOKEN değerini kontrol et.
- Tokenın başında veya sonunda boşluk olmadığından emin ol.
- npm install komutunu tekrar çalıştır.
- Node.js sürümünün 22 veya 24 olduğundan emin ol.

### Boost bildirimi gelmiyor

- .boost-kanal #kanal ile kanal ayarlanmış mı kontrol et.
- Botun kanalda Mesaj Gönder ve Embed Links izinlerini kontrol et.
- Gerçek boost başlangıcı test et; mevcut boostun rol değişiklikleri her zaman yeni boost olarak algılanmaz.
- GIF için doğrudan medya bağlantısı kullan.

### Rol verilmiyor

- Botta Rolleri Yönet izni olduğundan emin ol.
- Bot rolünü hedef rolün üstüne taşı.
- Rolün bot veya entegrasyon tarafından yönetilmediğini kontrol et.
- Rolü doğru kategoriyle ekle: .roller-ekle @Rol oyun

### Rol menüsü kanalı tekrar oluşuyor

- data/bot-data.json dosyasının silinmediğini kontrol et.
- Botun kanalları görme ve kanalları yönetme izinlerini kontrol et.
- Aynı isimde eski ve yeni kanallar varsa kullanılacak kanalın adını rol-menusu yap.

### Komut çalışmıyor

- Komutun başında nokta olduğundan emin ol.
- Komutları sunucu içinde kullan.
- Yönetici gerektiren komutlarda gerekli kullanıcı iznini kontrol et.
- Message Content Intent açık olmalı.

## Geliştirme

~~~bash
npm install
npm start
~~~

Kaynak kodun ana dosyaları:

- src/index.js — Discord eventleri, komutlar, menüler ve bildirimler
- src/db.js — JSON tabanlı ayar ve rol kayıtları
- data/bot-data.json — çalışma sırasında oluşan sunucu ayarları

## Lisans

MIT
