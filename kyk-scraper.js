const axios = require('axios');
const puppeteer = require('puppeteer');

/**
 * KYK Yemek Liste sitesinden Balıkesir yemek listesini çeker
 * https://kykyemekliste.com
 * 
 * Site Next.js ile yapılmış ve client-side render ediliyor,
 * bu yüzden Puppeteer kullanarak render edilmiş sayfayı çekiyoruz
 */

const BASE_URL = 'https://kykyemekliste.com';
const SEHIR = 'balikesir'; // Balıkesir

/**
 * Balıkesir yemek listesini çek
 * @param {string} ogun - 'kahvalti' veya 'aksam'
 * @param {string} tarih - YYYY-MM-DD formatında (opsiyonel, bugün için varsayılan)
 */
async function getBalikesirYemekListesi(ogun = 'aksam', tarih = null) {
    let browser = null;
    
    try {
        // Tarih belirtilmemişse bugünü kullan
        if (!tarih) {
            const today = new Date();
            tarih = today.toISOString().split('T')[0];
        }

        // URL oluştur
        const url = `${BASE_URL}/${SEHIR}/${ogun}`;
        
        console.log(`📡 Sayfa yükleniyor: ${url}`);
        
        // Puppeteer ile tarayıcı başlat
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        const page = await browser.newPage();
        
        // User agent ayarla
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        
        // Sayfayı yükle ve render olmasını bekle
        await page.goto(url, { 
            waitUntil: 'domcontentloaded',
            timeout: 60000 
        });
        
        // Sayfanın yüklenmesini bekle (React component'lerin render olması için)
        await new Promise(resolve => setTimeout(resolve, 8000));
        
        // Yemek listesi yüklenene kadar bekle
        try {
            // "Yükleniyor" metni kaybolana kadar bekle
            await page.waitForFunction(
                () => !document.body.textContent.includes('Yükleniyor'),
                { timeout: 15000 }
            );
        } catch (e) {
            console.log('⚠️  Yükleme tamamlanmadı, devam ediliyor...');
        }
        
        // Sayfadaki yemek listesini çek
        const yemekData = await page.evaluate(() => {
            // Script tag'lerini hariç tut
            const scripts = document.querySelectorAll('script');
            scripts.forEach(script => script.remove());
            
            // Görünür elementleri bul
            const visibleElements = Array.from(document.querySelectorAll('*'))
                .filter(el => {
                    const style = window.getComputedStyle(el);
                    return style.display !== 'none' && 
                           style.visibility !== 'hidden' &&
                           el.offsetWidth > 0 &&
                           el.offsetHeight > 0;
                });
            
            const yemekler = [];
            
            // Görünür elementlerden metinleri çıkar
            visibleElements.forEach(el => {
                const text = el.textContent?.trim() || '';
                if (text && text.length > 3 && text.length < 100) {
                    // Yemek adı gibi görünen metinleri filtrele
                    const excludePatterns = [
                        /^\d+[A-Za-z]{2,3}$/, // Tarih formatı (1Pzt, 2Sal, etc.)
                        /^(Tarih|Gün|Öğün|Yemek|Menü|Yükleniyor|Balıkesir|KYK|Akşam|Kahvaltı|Sabah|İl|Şehir|Hakkında|Rehber|SSS|İletişim)/i,
                        /http/i,
                        /@/,
                        /^\d+$/, // Sadece sayı
                        /^[A-Z]{1,3}$/, // Kısa kısaltmalar
                        /self\.__next_f/, // Next.js script kodu
                        /IconMark/,
                        /metadata/,
                    ];
                    
                    const shouldExclude = excludePatterns.some(pattern => pattern.test(text));
                    
                    if (!shouldExclude && 
                        !text.includes('©') &&
                        !text.includes('•') &&
                        !text.match(/^[A-ZÇĞİÖŞÜ][a-zçğıöşü]+ [A-ZÇĞİÖŞÜ]/)) { // Tarih formatı
                        yemekler.push(text);
                    }
                }
            });
            
            // Tekrarları kaldır ve benzersiz yemekleri döndür
            const uniqueYemekler = [...new Set(yemekler)];
            
            // En uzun metinleri al (yemek isimleri genelde daha uzun ve anlamlı)
            const sorted = uniqueYemekler
                .filter(y => y.length > 5) // En az 5 karakter
                .sort((a, b) => b.length - a.length)
                .slice(0, 10);
            
            return sorted.length > 0 ? sorted : uniqueYemekler.slice(0, 10);
        });
        
        await browser.close();
        
        // Eğer yemek bulunduysa formatla
        if (yemekData && yemekData.length > 0) {
            return {
                tarih: tarih,
                ogun: ogun,
                sehir: SEHIR,
                yemekler: yemekData
            };
        } else {
            // Eğer yemek bulunamazsa, varsayılan bir mesaj döndür
            throw new Error('Yemek listesi bulunamadı. Site yapısı değişmiş olabilir.');
        }

    } catch (error) {
        if (browser) {
            await browser.close();
        }
        console.error('❌ Hata:', error.message);
        throw error;
    }
}

// Test için
if (require.main === module) {
    (async () => {
        try {
            console.log('🍽️  Balıkesir KYK Yemek Listesi Çekiliyor...\n');
            
            const aksam = await getBalikesirYemekListesi('aksam');
            console.log('\n🌙 Akşam Yemeği:');
            console.log(JSON.stringify(aksam, null, 2));
            
            const kahvalti = await getBalikesirYemekListesi('kahvalti');
            console.log('\n🌤️  Kahvaltı:');
            console.log(JSON.stringify(kahvalti, null, 2));
            
        } catch (error) {
            console.error('Hata:', error.message);
        }
    })();
}

module.exports = { getBalikesirYemekListesi };

