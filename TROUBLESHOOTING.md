# WhatsApp Bağlantı Sorunları - Sorun Giderme Kılavuzu

## "Yeni Cihaz Bağlanılamıyor" Hatası

Bu hata WhatsApp'ın güvenlik önlemleri nedeniyle oluşur. İşte çözüm yolları:

### 1. Bekleme Süresi (En Önemli!)

WhatsApp rate limiting uygular. **15-30 dakika bekleyin** ve tekrar deneyin.

### 2. WhatsApp'ta Bekleyen Cihazları Temizle

1. WhatsApp'ı açın
2. Ayarlar > Cihazlar
3. Bekleyen/onaylanmamış cihaz bağlantılarını kontrol edin
4. Varsa kaldırın
5. Botu yeniden başlatın

### 3. Auth Bilgilerini Temizle

```bash
cd /Applications/XAMPP/xamppfiles/htdocs/yemek_wp
rm -rf .wwebjs_auth .wwebjs_cache
npm start
```

### 4. Farklı İnternet Bağlantısı

- WiFi yerine mobil veri kullanın
- VPN kullanıyorsanız kapatın
- Farklı bir ağ deneyin

### 5. WhatsApp'ı Yeniden Başlat

- WhatsApp'ı tamamen kapatın
- Telefonu yeniden başlatın (opsiyonel)
- WhatsApp'ı açın
- Botu tekrar başlatın

### 6. Tarayıcı Penceresini Kontrol Et

Bot `headless: false` modunda çalışıyor, bir Chrome penceresi açılmalı. Orada WhatsApp Web sayfası görünecek ve hata mesajını görebilirsiniz.

### 7. Manuel WhatsApp Web Bağlantısı (Alternatif)

Eğer QR kod çalışmıyorsa:

1. Normal bir tarayıcıda (Chrome/Safari) `web.whatsapp.com` adresine gidin
2. QR kodu telefonunuzla tarayın ve bağlanın
3. Botu durdurun
4. `.wwebjs_auth` klasörünü silin
5. Botu yeniden başlatın

### 8. WhatsApp Business API Kullanımı (İleri Seviye)

Eğer sürekli sorun yaşıyorsanız, resmi WhatsApp Business API kullanabilirsiniz (ücretli).

## Hala Çalışmıyor mu?

1. **30 dakika bekleyin** - WhatsApp rate limiting çok sıkıdır
2. **Farklı bir telefon numarası deneyin** - Bazı numaralar daha sıkı kontrol altındadır
3. **Gece saatlerinde deneyin** - Daha az trafik olduğu için başarı şansı artar

## Log Kontrolü

Bot çalışırken terminal çıktısını kontrol edin:

```bash
# Bot loglarını görmek için
npm start
```

Hata mesajlarını not edin ve gerekirse GitHub issues'da arayın.

