# Manuel Bağlantı Kılavuzu

## Tarayıcıdan WhatsApp Web'e Bağlanma (Önerilen Yöntem)

Bu yöntem, WhatsApp'ın "yeni cihaz bağlanılamıyor" hatasını aşmanın en kolay yoludur!

### Adımlar:

1. **Botu Başlatın**
   ```bash
   npm start
   ```

2. **Chrome Penceresi Açılacak**
   - Bot `headless: false` modunda çalışıyor
   - Otomatik olarak bir Chrome penceresi açılacak
   - WhatsApp Web sayfası yüklenecek

3. **Manuel Olarak Bağlanın**
   - Açılan Chrome penceresinde WhatsApp Web sayfasını görüyorsunuz
   - Telefonunuzla WhatsApp'ı açın
   - Ayarlar > Cihazlar > Cihaz Bağla
   - Chrome penceresindeki QR kodu telefonunuzla tarayın
   - Normal WhatsApp Web bağlantısı gibi bağlanın

4. **Bot Otomatik Algılayacak**
   - Bağlantı kurulduğunda bot otomatik olarak algılayacak
   - Session bilgileri `.wwebjs_auth` klasörüne kaydedilecek
   - Terminal'de "✅ WhatsApp bot hazır!" mesajını göreceksiniz

5. **Bir Sonraki Başlatmada**
   - Artık QR kod gerekmez
   - Bot otomatik olarak kaydedilen session ile bağlanacak
   - Sadece `npm start` yapmanız yeterli!

### Avantajları:

✅ WhatsApp rate limiting'i aşar  
✅ QR kod sorunları olmaz  
✅ Normal WhatsApp Web bağlantısı gibi çalışır  
✅ Daha güvenilir ve stabil  

### Sorun Giderme:

**Chrome penceresi açılmıyor:**
- `headless: false` ayarının aktif olduğundan emin olun
- Bot kodunda `headless: false` olmalı

**Bağlantı kurulamıyor:**
- Chrome penceresinde WhatsApp Web sayfasının tam yüklendiğinden emin olun
- Normal tarayıcıda WhatsApp Web'e bağlanabiliyorsanız, burada da bağlanabilmelisiniz

**Session kaydedilmiyor:**
- `.wwebjs_auth` klasörünün yazılabilir olduğundan emin olun
- Botu kapatmadan önce bağlantının kurulduğundan emin olun

## Alternatif: Export/Import Yöntemi

Eğer yukarıdaki yöntem çalışmazsa:

1. `export-session.html` dosyasını normal tarayıcınızda açın (WhatsApp Web'e bağlıyken)
2. Session bilgilerini export edin
3. `import-session.js` scriptini çalıştırın

Ancak bu yöntem daha karmaşık ve WhatsApp Web.js'in session formatı nedeniyle tam çalışmayabilir.

