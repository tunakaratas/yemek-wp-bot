# KYK Yurdu WhatsApp Yemek Botu

WhatsApp grubunda bot numarasını etiketlediğinizde, o günün yemek menüsünü gönderen bot.

## Özellikler

- ✅ WhatsApp Web.js ile QR kod ile bağlanma
- ✅ Grup mesajlarını dinleme
- ✅ Bot etiketlendiğinde otomatik yanıt
- ✅ API'den yemek menüsü çekme
- ✅ Türkçe tarih formatı ile güzel mesajlar
- 🛡️ **Anti-Ban Koruması** - WhatsApp'tan ban yememesi için gelişmiş koruma sistemi
  - Rate limiting (mesaj gönderme hızı kontrolü)
  - Cooldown sistemi (kullanıcı/grup bazlı bekleme)
  - Günlük/saatlik mesaj limitleri
  - Spam koruması (kullanıcı başına istek limiti)
  - Rastgele gecikmeler (human-like behavior)
  - Hata durumlarında akıllı retry

## Kurulum

### 1. Bağımlılıkları yükleyin

```bash
npm install
```

### 2. Test API Sunucusunu Başlatın (Opsiyonel)

Projede test için hazır bir API sunucusu var. Başlatmak için:

```bash
npm run api
```

veya

```bash
node api-server.js
```

API sunucusu `http://localhost:3000` adresinde çalışacak.

**API Endpoint'leri:**
- `GET /yemek?tarih=2024-01-15` - Yemek menüsü (tarih opsiyonel, bugün için varsayılan)
- `GET /menuler` - Tüm kayıtlı menüler
- `POST /yemek` - Yeni menü ekle
- `GET /health` - Health check

### 3. Botu Başlatın

Yeni bir terminal açın ve:

```bash
npm start
```

veya

```bash
node bot.js
```

### 4. QR Kodu Tarayın

Terminal'de görünen QR kodu WhatsApp ile tarayın (Ayarlar > Cihazlar > Cihaz Bağla).

**Not:** Bot varsayılan olarak `http://localhost:3000/yemek` adresini kullanır. Farklı bir API kullanmak isterseniz:

**Yöntem 1: Environment variable**
```bash
export YEMEK_API_URL="https://api.example.com/yemek"
npm start
```

**Yöntem 2: Bot kodunu düzenleyin**

`bot.js` dosyasındaki `config` objesinde `YEMEK_API_URL` değerini değiştirin.

## API Formatı

Bot, API'den şu formatta veri bekler:

```json
{
  "tarih": "2024-01-15",
  "yemekler": [
    "Mercimek Çorbası",
    "Izgara Tavuk",
    "Pilav",
    "Salata",
    "Sütlaç"
  ]
}
```

Veya alternatif format:

```json
{
  "tarih": "2024-01-15",
  "menu": {
    "Çorba": "Mercimek Çorbası",
    "Ana Yemek": "Izgara Tavuk",
    "Yan Yemek": "Pilav",
    "Salata": "Mevsim Salatası",
    "Tatlı": "Sütlaç"
  }
}
```

API'ye `tarih` parametresi gönderilir (YYYY-MM-DD formatında).

## Kullanım

1. Bot numarasını WhatsApp grubuna ekleyin
2. Grupta bot numarasını etiketleyin (mention yapın)
3. Bot otomatik olarak o günün yemek menüsünü gönderecek

## Notlar

- Bot ilk çalıştırmada QR kod gösterecek, bunu tarayarak WhatsApp'ı bağlayın
- QR kod bilgileri `.wwebjs_auth` klasöründe saklanır, bir sonraki çalıştırmada tekrar taramaya gerek yok
- Bot sadece grup mesajlarını dinler
- Bot etiketlendiğinde (mention) yanıt verir

## Sorun Giderme

### QR kod görünmüyor
- Terminal penceresini büyütün
- `qrcode-terminal` paketinin yüklü olduğundan emin olun

### Bot mesaj göndermiyor
- Botun gruba eklendiğinden emin olun
- Bot numarasını doğru etiketlediğinizden emin olun
- API endpoint'inin çalıştığından emin olun

### API bağlantı hatası
- API URL'ini kontrol edin
- API'nin erişilebilir olduğundan emin olun
- API'nin CORS ayarlarını kontrol edin (gerekirse)

## Test API Sunucusu

Projede test için hazır bir Express.js API sunucusu bulunmaktadır (`api-server.js`). Bu sunucu:

- Örnek yemek menüleri içerir
- Tarihe göre menü döndürür
- Yeni menü ekleme özelliği vardır
- CORS desteği ile çalışır

**Yeni menü eklemek için:**
```bash
curl -X POST http://localhost:3000/yemek \
  -H "Content-Type: application/json" \
  -d '{"tarih":"2024-01-20","yemekler":["Çorba","Yemek1","Yemek2"]}'
```

## Geliştirme

Bot kodunu `bot.js` dosyasından düzenleyebilirsiniz. Değişikliklerden sonra botu yeniden başlatın.

API sunucusunu `api-server.js` dosyasından düzenleyebilirsiniz. Yemek menülerini `yemekMenuleri` objesine ekleyebilirsiniz.

## Lisans

ISC

