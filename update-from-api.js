const { fetchBalikesirYemekListesi } = require('./kyk-api-scraper');
const fs = require('fs');
const path = require('path');

/**
 * API'den çekilen verileri mevcut JSON formatına uygun hale getir ve güncelle
 */
async function updateYemekListesiFromAPI() {
    try {
        console.log('🔄 API\'den yemek listesi güncelleniyor...\n');
        
        // API'den verileri çek
        const apiData = await fetchBalikesirYemekListesi();
        
        // Mevcut JSON dosyasını oku (varsa)
        const jsonPath = path.join(__dirname, 'balikesir-yemek-listesi.json');
        let existingData = {};
        
        if (fs.existsSync(jsonPath)) {
            try {
                existingData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
                console.log(`📄 Mevcut dosyada ${Object.keys(existingData).length} günlük menü var`);
            } catch (error) {
                console.log('⚠️  Mevcut dosya okunamadı, yeni dosya oluşturulacak');
            }
        }
        
        // API verilerini mevcut verilerle birleştir (API verileri öncelikli)
        const mergedData = { ...existingData, ...apiData };
        
        // Tarihlere göre sırala
        const sortedData = {};
        Object.keys(mergedData).sort().forEach(tarih => {
            sortedData[tarih] = mergedData[tarih];
        });
        
        // Yedek al
        if (fs.existsSync(jsonPath)) {
            const backupPath = jsonPath + '.backup.' + Date.now();
            fs.copyFileSync(jsonPath, backupPath);
            console.log(`💾 Yedek oluşturuldu: ${backupPath}`);
        }
        
        // Güncellenmiş veriyi kaydet
        fs.writeFileSync(jsonPath, JSON.stringify(sortedData, null, 2));
        
        console.log(`\n✅ Başarılı!`);
        console.log(`📊 Toplam ${Object.keys(sortedData).length} günlük menü kaydedildi`);
        console.log(`📅 Tarih aralığı: ${Object.keys(sortedData)[0]} - ${Object.keys(sortedData)[Object.keys(sortedData).length - 1]}`);
        console.log(`\n💾 Dosya: ${jsonPath}`);
        
        return sortedData;
        
    } catch (error) {
        console.error('❌ Hata:', error.message);
        throw error;
    }
}

// Test
if (require.main === module) {
    updateYemekListesiFromAPI()
        .then(() => {
            console.log('\n✨ Güncelleme tamamlandı!');
            process.exit(0);
        })
        .catch(error => {
            console.error('❌ Güncelleme başarısız:', error);
            process.exit(1);
        });
}

module.exports = { updateYemekListesiFromAPI };

