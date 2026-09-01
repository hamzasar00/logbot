# logbot V2.0 Geliştirme Planı

Bu dal, mevcut çalışan sürümü bozmadan V2 geliştirmeleri için hazırlanmıştır.

## Değişmez uyumluluk kuralları

- Mevcut `.setup`, `.log`, `.oda`, `.roller` ve `.yardım` prefix komutları çalışmaya devam edecek.
- Mevcut log eventleri ve özel oda oluşturma akışı kaldırılmayacak; yeni davranışlar mevcut fonksiyonların üzerine eklenecek.
- Yeni otomatik özellikler varsayılan olarak kapalı veya güvenli sınırlarla başlayacak.
- JSON veri dosyası silinmeyecek; `version` alanı üzerinden geriye dönük migration yapılacak.
- Her yeni özellik hata verdiğinde botun diğer event handlerlarını durdurmayacak.

## Aşama 0 - Sağlam temel

- Ortak Discord yetki kontrolü ve yönetici/moderatör ayrımı.
- Komut cooldown ve merkezi kullanıcıya güvenli hata yanıtı.
- Kanal, rol ve mesaj bulunamadığında temiz şekilde devam etme.
- `db.js` içinde V2 state migration ve yeni ayarların varsayılanları.
- Prefix komutları korunurken slash komutları için ortak command handler yapısı.

## Aşama 1 - Gelişmiş moderasyon

- Uyarı ekleme, uyarıları listeleme ve uyarı silme.
- Uyarı geçmişini moderasyon log kanalına gönderme.
- Spam, flood, caps, davet linki ve yasaklı kelime filtreleri.
- Otomatik işlem seçenekleri: mesaj silme, uyarı, timeout.
- Tüm otomatik filtreler sunucu bazında ayarlanabilir ve varsayılan olarak kapalıdır.

## Aşama 2 - Hoş geldin ve otomatik rol

- Hoş geldin ve ayrılma kanalı seçimi.
- Değişken destekli mesaj şablonları: kullanıcı, sunucu ve üye sayısı.
- Yeni üyeye otomatik rol verme.
- Bot ve insan üyeler için ayrı davranış seçeneği.

## Aşama 3 - Özel oda 2.0

- Oda sahibinin oda devri yapabilmesi.
- Oda kilitleme/açma, kullanıcı davet etme ve çıkarma.
- Oda adı ve kişi limiti güncelleme.
- Oda tercihlerini sunucu ayarlarında güvenli şekilde saklama.
- Mevcut boş oda ve sahip ayrılınca kapanma davranışı korunacak.

## Aşama 4 - İstatistik ve aktivite

- Mesaj, katılım/ayrılma ve ses aktivitesi için sunucu bazlı sayaçlar.
- Günlük ve haftalık özet komutları.
- Sayımların bot yeniden başladığında kaybolmaması.
- İstatistik özelliği kapatıldığında gereksiz veri yazılmaması.

## Aşama 5 - Slash komutları

- Mevcut prefix komutlarının yanında slash karşılıkları.
- Aynı iş mantığına yönlendirme; iki farklı kopya handler yazılmaması.
- Komut açıklamaları, seçenek doğrulama ve yetki kontrolleri.
- Global komutlar yerine geliştirme aşamasında sunucu bazlı kayıt.

## Uygulama sırası

1. State migration ve ortak güvenlik yardımcıları.
2. Moderasyon kayıtları ve filtre ayarları.
3. Hoş geldin/otomatik rol.
4. Özel oda 2.0.
5. İstatistikler.
6. Slash komutlarının ortak handler'a bağlanması.

## Kabul ölçütleri

- Eski ayar dosyası V2 ile açıldığında veri kaybı olmamalı.
- Yeni özelliklerden biri hata verdiğinde bot kapanmamalı.
- Yönetici olmayan kullanıcılar yönetim komutlarını çalıştıramamalı.
- Her yeni ayar sunucu bazında izole tutulmalı.
- Mevcut log kanalları ve özel oda lifecycle davranışı korunmalı.
