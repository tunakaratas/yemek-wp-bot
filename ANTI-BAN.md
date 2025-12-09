# 🛡️ Anti-Ban Koruması

Bot, WhatsApp'tan ban yememesi için gelişmiş koruma sistemleri içerir.

## Koruma Özellikleri

### 1. Rate Limiting (Mesaj Gönderme Hızı Kontrolü)
- Her mesaj arasında **2-5 saniye** rastgele bekleme
- Çok hızlı mesaj göndermeyi önler
- Human-like (insan gibi) davranış simülasyonu

### 2. Cooldown Sistemi
- **Kullanıcı Cooldown**: Aynı kullanıcıdan 30 saniye içinde tekrar istek gelirse reddedilir
- **Grup Cooldown**: Aynı gruptan 10 saniye içinde tekrar istek gelirse reddedilir
- Spam istekleri önler

### 3. Mesaj Limitleri
- **Günlük Limit**: Günde maksimum **100 mesaj**
- **Saatlik Limit**: Saatte maksimum **20 mesaj**
- Limit aşıldığında otomatik olarak durdurulur

### 4. Spam Koruması
- **Kullanıcı Başına İstek Limiti**: Saatte maksimum **5 istek**
- Aynı kullanıcıdan çok fazla istek gelirse uyarı verilir
- Spam davranışını tespit eder ve engeller

### 5. Hata Yönetimi
- Rate limit hatalarında sessizce geçer (spam gibi görünmez)
- Kritik hatalarda kullanıcıya bilgi verir
- Çok fazla retry yapmaz (sürekli deneme spam gibi görünür)

## Ayarlar

Anti-ban ayarları `bot.js` dosyasındaki `ANTI_BAN_CONFIG` objesinde bulunur:

```javascript
const ANTI_BAN_CONFIG = {
    MIN_MESSAGE_DELAY: 2000,        // Minimum bekleme (ms)
    MAX_MESSAGE_DELAY: 5000,         // Maksimum bekleme (ms)
    USER_COOLDOWN: 30,               // Kullanıcı cooldown (saniye)
    GROUP_COOLDOWN: 10,              // Grup cooldown (saniye)
    DAILY_MESSAGE_LIMIT: 100,        // Günlük mesaj limiti
    HOURLY_MESSAGE_LIMIT: 20,        // Saatlik mesaj limiti
    MAX_REQUESTS_PER_USER_PER_HOUR: 5 // Kullanıcı başına saatlik istek limiti
};
```

## Limit Aşıldığında Ne Olur?

- Kullanıcıya bilgilendirme mesajı gönderilir
- İstek reddedilir
- Cooldown süresi kadar beklenmesi gerekir
- Bot çalışmaya devam eder (sadece o istek reddedilir)

## Öneriler

1. **Limitleri Aşmayın**: Ayarları çok yüksek yapmayın
2. **Cooldown'ları Artırın**: Eğer çok fazla istek geliyorsa cooldown sürelerini artırın
3. **Mesaj Limitlerini Kontrol Edin**: Günlük/saatlik limitleri kullanımınıza göre ayarlayın
4. **Logları İzleyin**: `bot.log` dosyasını kontrol ederek limit durumlarını takip edin

## Log Örnekleri

```
📊 Günlük: 45/100, Saatlik: 12/20
⏳ Cooldown: 15 saniye kaldı
⚠️  Rate limit: Kullanıcı çok fazla istek gönderdi. 25 dakika bekleyin.
```

## Güvenlik

Bu koruma sistemleri sayesinde:
- ✅ WhatsApp spam algılamasından korunur
- ✅ Rate limiting ihlallerinden korunur
- ✅ Otomatik davranış tespitinden korunur
- ✅ Ban riski minimuma iner

**Not**: Hiçbir sistem %100 garanti vermez, ancak bu özellikler ban riskini önemli ölçüde azaltır.

