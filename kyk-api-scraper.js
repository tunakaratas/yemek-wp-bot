const axios = require('axios');
const fs = require('fs');

const BASE_URL = 'https://kykyemekliste.com/api';
const BALIKESIR_CITY_ID = 10; // Balıkesir
const MEAL_TYPE_KAHVALTI = 0; // Kahvaltı
const MEAL_TYPE_AKSAM = 1; // Akşam yemeği

/**
 * Balıkesir yemek listesini API'den çek
 */
async function fetchBalikesirYemekListesi() {
    try {
        console.log('🍽️  Balıkesir KYK Yemek Listesi API\'den çekiliyor...\n');

        // Kahvaltı menüsü
        console.log('🌤️  Kahvaltı menüsü çekiliyor...');
        const kahvaltiResponse = await axios.get(`${BASE_URL}/menu/liste`, {
            params: {
                cityId: BALIKESIR_CITY_ID,
                mealType: MEAL_TYPE_KAHVALTI
            }
        });

        console.log(`   ✅ ${kahvaltiResponse.data?.length || 0} günlük kahvaltı menüsü bulundu`);

        // Akşam yemeği menüsü
        console.log('🌙 Akşam yemeği menüsü çekiliyor...');
        const aksamResponse = await axios.get(`${BASE_URL}/menu/liste`, {
            params: {
                cityId: BALIKESIR_CITY_ID,
                mealType: MEAL_TYPE_AKSAM
            }
        });

        console.log(`   ✅ ${aksamResponse.data?.length || 0} günlük akşam yemeği menüsü bulundu`);

        // Verileri formatla
        const formattedData = formatYemekData(kahvaltiResponse.data, aksamResponse.data);

        return formattedData;

    } catch (error) {
        console.error('❌ API hatası:', error.message);
        if (error.response) {
            console.error('   Status:', error.response.status);
            console.error('   Data:', JSON.stringify(error.response.data, null, 2));
        }
        throw error;
    }
}

/**
 * API'den gelen verileri JSON formatına çevir
 */
function formatYemekData(kahvaltiData, aksamData) {
    const result = {};

    // Kahvaltı verilerini işle
    if (Array.isArray(kahvaltiData)) {
        kahvaltiData.forEach(item => {
            const tarih = item.tarih || item.date || item.gun;
            if (!tarih) return;

            // Tarih formatını normalize et (YYYY-MM-DD)
            const normalizedTarih = normalizeTarih(tarih);
            
            if (!result[normalizedTarih]) {
                result[normalizedTarih] = {
                    tarih: normalizedTarih,
                    kahvalti: [],
                    aksam: []
                };
            }

            // Yemek listesini çıkar
            const yemekler = extractYemekler(item);
            result[normalizedTarih].kahvalti = yemekler;
        });
    }

    // Akşam yemeği verilerini işle
    if (Array.isArray(aksamData)) {
        aksamData.forEach(item => {
            const tarih = item.tarih || item.date || item.gun;
            if (!tarih) return;

            const normalizedTarih = normalizeTarih(tarih);
            
            if (!result[normalizedTarih]) {
                result[normalizedTarih] = {
                    tarih: normalizedTarih,
                    kahvalti: [],
                    aksam: []
                };
            }

            const yemekler = extractYemekler(item);
            result[normalizedTarih].aksam = yemekler;
        });
    }

    return result;
}

/**
 * Tarih formatını normalize et
 */
function normalizeTarih(tarih) {
    if (typeof tarih !== 'string') {
        return null;
    }

    // YYYY-MM-DD formatına çevir
    // Örnek: "2025-12-01", "01.12.2025", "01/12/2025", "1 Aralık 2025"
    
    // Zaten YYYY-MM-DD formatındaysa
    if (/^\d{4}-\d{2}-\d{2}$/.test(tarih)) {
        return tarih;
    }

    // DD.MM.YYYY veya DD/MM/YYYY formatı
    const match1 = tarih.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
    if (match1) {
        const [, gun, ay, yil] = match1;
        return `${yil}-${ay.padStart(2, '0')}-${gun.padStart(2, '0')}`;
    }

    // Türkçe tarih formatı (örn: "1 Aralık 2025")
    const ayIsimleri = {
        'ocak': '01', 'şubat': '02', 'mart': '03', 'nisan': '04', 'mayıs': '05', 'haziran': '06',
        'temmuz': '07', 'ağustos': '08', 'eylül': '09', 'ekim': '10', 'kasım': '11', 'aralık': '12'
    };
    
    const match2 = tarih.match(/^(\d{1,2})\s+(\w+)\s+(\d{4})$/i);
    if (match2) {
        const [, gun, ay, yil] = match2;
        const ayNumarasi = ayIsimleri[ay.toLowerCase()];
        if (ayNumarasi) {
            return `${yil}-${ayNumarasi}-${gun.padStart(2, '0')}`;
        }
    }

    return tarih; // Değiştirilemezse olduğu gibi döndür
}

/**
 * API item'ından yemek listesini çıkar
 * API formatı: { first, second, third, fourth, ... }
 */
function extractYemekler(item) {
    const yemekler = [];
    
    // API'den gelen format: first, second, third, fourth alanları
    const fields = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'];
    
    for (const field of fields) {
        if (item[field] && typeof item[field] === 'string') {
            // "/" ile ayrılmış seçenekleri ayır
            const options = item[field].split('/').map(opt => opt.trim()).filter(opt => opt.length > 0);
            yemekler.push(...options);
        }
    }
    
    return yemekler;
}

// Test
if (require.main === module) {
    fetchBalikesirYemekListesi()
        .then(data => {
            console.log('\n✅ Başarılı!');
            console.log(`📊 Toplam ${Object.keys(data).length} günlük menü bulundu\n`);
            
            // İlk birkaç günü göster
            const tarihler = Object.keys(data).sort().slice(0, 5);
            tarihler.forEach(tarih => {
                console.log(`📅 ${tarih}:`);
                console.log(`   🌤️  Kahvaltı: ${data[tarih].kahvalti.length} öğe`);
                console.log(`   🌙 Akşam: ${data[tarih].aksam.length} öğe`);
            });

            // JSON dosyasına kaydet
            fs.writeFileSync('balikesir-api-scraped.json', JSON.stringify(data, null, 2));
            console.log('\n💾 Veriler balikesir-api-scraped.json dosyasına kaydedildi');
        })
        .catch(error => {
            console.error('❌ Hata:', error.message);
            process.exit(1);
        });
}

module.exports = { fetchBalikesirYemekListesi };

