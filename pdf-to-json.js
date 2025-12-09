const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');

/**
 * PDF dosyalarından yemek listelerini çıkarıp JSON formatına çevirir
 */

async function extractPDFContent(pdfPath) {
    try {
        const dataBuffer = fs.readFileSync(pdfPath);
        // pdf-parse direkt fonksiyon olarak export ediliyor
        const data = await pdfParse(dataBuffer);
        return data.text;
    } catch (error) {
        console.error(`❌ PDF okuma hatası (${pdfPath}):`, error.message);
        console.error('Stack:', error.stack);
        return null;
    }
}

async function parseYemekListesi() {
    console.log('📄 PDF dosyaları okunuyor...\n');
    
    // PDF dosyalarını oku
    const aksamPDF = path.join(__dirname, 'KYK Yemek Listesi - 81 İl Güncel Yurt Menüleri.pdf');
    const kahvaltiPDF = path.join(__dirname, 'KYK Yemek Listesi kahvaltı - 81 İl Güncel Yurt Menüleri.pdf');
    
    const aksamText = await extractPDFContent(aksamPDF);
    const kahvaltiText = await extractPDFContent(kahvaltiPDF);
    
    if (!aksamText || !kahvaltiText) {
        console.error('❌ PDF dosyaları okunamadı!');
        return;
    }
    
    console.log('✅ PDF dosyaları okundu\n');
    console.log('📝 İçerik parse ediliyor...\n');
    
    // Metinleri analiz et ve yemek listelerini çıkar
    // Bu kısım PDF formatına göre özelleştirilmeli
    console.log('⚠️  PDF içeriği parse ediliyor...');
    console.log('📋 İlk 500 karakter (akşam):');
    console.log(aksamText.substring(0, 500));
    console.log('\n📋 İlk 500 karakter (kahvaltı):');
    console.log(kahvaltiText.substring(0, 500));
    
    // Şimdilik kullanıcıdan metin formatında göndermesini isteyelim
    // veya PDF içeriğini daha detaylı analiz edelim
    
    // Metinleri dosyaya kaydet (analiz için)
    fs.writeFileSync('aksam-raw.txt', aksamText);
    fs.writeFileSync('kahvalti-raw.txt', kahvaltiText);
    
    console.log('\n✅ Ham metin dosyalara kaydedildi:');
    console.log('   - aksam-raw.txt');
    console.log('   - kahvalti-raw.txt');
    console.log('\n💡 Bu dosyaları kontrol edip JSON formatına çevirebiliriz.');
}

// Scripti çalıştır
parseYemekListesi().catch(console.error);

