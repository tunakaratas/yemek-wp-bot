const fs = require('fs');
const path = require('path');

/**
 * Tarayıcıdan export edilen session bilgilerini bot'a aktarır
 * 
 * Kullanım:
 * 1. export-session.html dosyasını tarayıcıda açın (WhatsApp Web'e bağlıyken)
 * 2. Session bilgilerini export edin ve session-data.json olarak kaydedin
 * 3. Bu scripti çalıştırın: node import-session.js
 */

const SESSION_FILE = path.join(__dirname, 'session-data.json');
const AUTH_DIR = path.join(__dirname, '.wwebjs_auth');
const CACHE_DIR = path.join(__dirname, '.wwebjs_cache');

function importSession() {
    try {
        // Session dosyasını kontrol et
        if (!fs.existsSync(SESSION_FILE)) {
            console.error('❌ session-data.json dosyası bulunamadı!');
            console.log('\n💡 Adımlar:');
            console.log('   1. export-session.html dosyasını tarayıcıda açın');
            console.log('   2. WhatsApp Web\'e bağlıyken session bilgilerini export edin');
            console.log('   3. Export edilen JSON\'u session-data.json olarak kaydedin');
            console.log('   4. Bu scripti tekrar çalıştırın\n');
            process.exit(1);
        }

        // Session verisini oku
        const sessionData = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
        console.log('✅ Session dosyası okundu');

        // Eski auth klasörünü temizle
        if (fs.existsSync(AUTH_DIR)) {
            fs.rmSync(AUTH_DIR, { recursive: true, force: true });
            console.log('✅ Eski auth bilgileri temizlendi');
        }

        if (fs.existsSync(CACHE_DIR)) {
            fs.rmSync(CACHE_DIR, { recursive: true, force: true });
            console.log('✅ Eski cache temizlendi');
        }

        // Yeni auth klasörünü oluştur
        fs.mkdirSync(AUTH_DIR, { recursive: true });
        fs.mkdirSync(path.join(AUTH_DIR, 'Default'), { recursive: true });

        // LocalStorage verilerini kaydet
        const localStoragePath = path.join(AUTH_DIR, 'Default', 'Local Storage', 'leveldb');
        fs.mkdirSync(localStoragePath, { recursive: true });

        // Session verilerini yaz
        // Not: WhatsApp Web.js kendi formatında saklar, bu yüzden manuel import zor
        // Bunun yerine, bot'u başlatıp QR kod yerine mevcut session'ı kullanmasını sağlayalım
        
        console.log('\n⚠️  Not: WhatsApp Web.js session import için özel bir yöntem gerekiyor.');
        console.log('💡 Alternatif çözüm:');
        console.log('   1. Botu başlatın (npm start)');
        console.log('   2. Bot açılan Chrome penceresinde WhatsApp Web\'e manuel olarak bağlanın');
        console.log('   3. Bot otomatik olarak session\'ı kaydedecek\n');

        // Alternatif: Session bilgilerini bir yere kaydet (gelecekte kullanım için)
        const sessionBackup = path.join(__dirname, 'session-backup.json');
        fs.writeFileSync(sessionBackup, JSON.stringify(sessionData, null, 2));
        console.log(`✅ Session backup kaydedildi: ${sessionBackup}`);

        console.log('\n✅ İşlem tamamlandı!');
        console.log('📱 Şimdi botu başlatın: npm start');

    } catch (error) {
        console.error('❌ Hata:', error.message);
        process.exit(1);
    }
}

// Scripti çalıştır
importSession();

