const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = 3000;

// CORS ayarları
app.use(cors());
app.use(express.json());

// Örnek yemek menüleri (tarihe göre)
const yemekMenuleri = {
    '2024-01-15': {
        tarih: '2024-01-15',
        yemekler: [
            'Mercimek Çorbası',
            'Izgara Tavuk',
            'Pilav',
            'Mevsim Salatası',
            'Sütlaç'
        ]
    },
    '2024-01-16': {
        tarih: '2024-01-16',
        yemekler: [
            'Yayla Çorbası',
            'Köfte',
            'Makarna',
            'Çoban Salatası',
            'Baklava'
        ]
    },
    '2024-01-17': {
        tarih: '2024-01-17',
        yemekler: [
            'Domates Çorbası',
            'Balık',
            'Bulgur Pilavı',
            'Roka Salatası',
            'Kadayıf'
        ]
    },
    '2024-01-18': {
        tarih: '2024-01-18',
        yemekler: [
            'Tavuk Çorbası',
            'Karnıyarık',
            'Pilav',
            'Yeşil Salata',
            'Revani'
        ]
    },
    '2024-01-19': {
        tarih: '2024-01-19',
        yemekler: [
            'Ezogelin Çorbası',
            'Tavuk Sote',
            'Pirinç Pilavı',
            'Karışık Salata',
            'Sütlaç'
        ]
    }
};

// Bugünün tarihini al
function getTodayDate() {
    const today = new Date();
    return today.toISOString().split('T')[0];
}

// Varsayılan menü (bugün için)
const defaultMenu = {
    tarih: getTodayDate(),
    yemekler: [
        'Mercimek Çorbası',
        'Izgara Tavuk',
        'Pilav',
        'Mevsim Salatası',
        'Sütlaç'
    ]
};

// JSON dosyasından yemek listesini yükle
function loadYemekListesi() {
    const jsonPath = path.join(__dirname, 'balikesir-yemek-listesi.json');
    if (fs.existsSync(jsonPath)) {
        try {
            const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
            console.log(`✅ Yemek listesi JSON dosyasından yüklendi`);
            return data;
        } catch (error) {
            console.error('❌ JSON dosyası okunamadı:', error.message);
            return null;
        }
    }
    return null;
}

// Ana endpoint - Yemek menüsü
app.get('/yemek', (req, res) => {
    const tarih = req.query.tarih || getTodayDate();
    const sehir = req.query.sehir || 'balikesir';
    const ogun = req.query.ogun || 'aksam'; // 'kahvalti' veya 'aksam'
    
    console.log(`📅 Yemek menüsü isteniyor - Tarih: ${tarih}, Şehir: ${sehir}, Öğün: ${ogun}`);
    
    // Önce JSON dosyasından yükle
    const jsonData = loadYemekListesi();
    
    if (jsonData && sehir === 'balikesir') {
        // Tarihe göre menü bul
        let menu = null;
        
        // Tarih formatını kontrol et (YYYY-MM-DD)
        // Sadece tam eşleşme varsa menüyü kullan
        if (jsonData[tarih]) {
            menu = jsonData[tarih];
        }
        
        if (menu) {
            // Öğüne göre filtrele
            if (ogun === 'aksam' && menu.aksam) {
                return res.json({
                    tarih: menu.tarih || tarih,
                    sehir: 'balikesir',
                    ogun: 'aksam',
                    yemekler: menu.aksam
                });
            } else if (ogun === 'kahvalti' && menu.kahvalti) {
                return res.json({
                    tarih: menu.tarih || tarih,
                    sehir: 'balikesir',
                    ogun: 'kahvalti',
                    yemekler: menu.kahvalti
                });
            } else if (menu.yemekler) {
                // Eğer öğün ayrımı yoksa genel yemekler
                return res.json({
                    tarih: menu.tarih || tarih,
                    sehir: 'balikesir',
                    ogun: ogun,
                    yemekler: menu.yemekler
                });
            }
        }
        
        // Eğer tarih bulunamadıysa 404 döndür
        return res.status(404).json({
            message: 'Belirtilen tarih için menü bulunamadı.',
            tarih: tarih
        });
    }
    
    // JSON'dan bulunamazsa ve balikesir değilse varsayılan menü
    const menu = yemekMenuleri[tarih] || defaultMenu;
    
    if (!yemekMenuleri[tarih]) {
        menu.tarih = tarih;
    }
    
    res.json(menu);
});

// Tüm menüleri listele (test için)
app.get('/menuler', (req, res) => {
    res.json(yemekMenuleri);
});

// Yeni menü ekle (test için)
app.post('/yemek', (req, res) => {
    const { tarih, yemekler } = req.body;
    
    if (!tarih || !yemekler) {
        return res.status(400).json({ 
            error: 'tarih ve yemekler alanları gereklidir' 
        });
    }
    
    yemekMenuleri[tarih] = {
        tarih,
        yemekler
    };
    
    console.log(`✅ Yeni menü eklendi - Tarih: ${tarih}`);
    res.json({ 
        success: true, 
        message: 'Menü başarıyla eklendi',
        menu: yemekMenuleri[tarih]
    });
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'API çalışıyor',
        tarih: getTodayDate()
    });
});

// API'den yemek listesini güncelle
app.post('/update-from-api', async (req, res) => {
    try {
        const { updateYemekListesiFromAPI } = require('./update-from-api');
        const result = await updateYemekListesiFromAPI();
        res.json({
            success: true,
            message: 'Yemek listesi API\'den başarıyla güncellendi',
            totalDays: Object.keys(result).length,
            dateRange: {
                start: Object.keys(result)[0],
                end: Object.keys(result)[Object.keys(result).length - 1]
            }
        });
    } catch (error) {
        console.error('❌ API güncelleme hatası:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Sunucuyu başlat
app.listen(PORT, () => {
    console.log(`🚀 Yemek API sunucusu çalışıyor: http://localhost:${PORT}`);
    console.log(`📅 Bugünün tarihi: ${getTodayDate()}`);
    console.log(`\n📋 Endpoint'ler:`);
    console.log(`   GET  /yemek?tarih=2024-01-15 - Yemek menüsü`);
    console.log(`   GET  /menuler - Tüm menüler`);
    console.log(`   POST /yemek - Yeni menü ekle`);
    console.log(`   GET  /health - Health check`);
});

