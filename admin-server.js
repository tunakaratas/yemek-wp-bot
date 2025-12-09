const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();
const PORT = 3001; // API server 3000'de, admin panel 3001'de

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'admin-panel')));

// Veri depolama (basit JSON dosyası)
const DATA_FILE = path.join(__dirname, 'bot-data.json');

// Veri yükleme
function loadData() {
    if (fs.existsSync(DATA_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        } catch (error) {
            console.error('Veri yükleme hatası:', error);
        }
    }
    return {
        groups: [],
        messages: [],
        stats: {
            totalMessages: 0,
            totalCommands: 0,
            lastUpdate: null
        }
    };
}

// Veri kaydetme
function saveData(data) {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Veri kaydetme hatası:', error);
    }
}

// API: Grupları getir
app.get('/api/groups', (req, res) => {
    const data = loadData();
    res.json(data.groups || []);
});

// API: Mesajları getir
app.get('/api/messages', (req, res) => {
    const data = loadData();
    const limit = parseInt(req.query.limit) || 100;
    const messages = (data.messages || []).slice(-limit).reverse();
    res.json(messages);
});

// API: İstatistikleri getir
app.get('/api/stats', (req, res) => {
    const data = loadData();
    res.json(data.stats || {});
});

// API: Grup ekle/güncelle (bot tarafından çağrılacak)
app.post('/api/groups', (req, res) => {
    const data = loadData();
    const group = req.body;
    
    if (!data.groups) {
        data.groups = [];
    }
    
    // Grup zaten var mı kontrol et
    const existingIndex = data.groups.findIndex(g => g.id === group.id);
    if (existingIndex >= 0) {
        data.groups[existingIndex] = { ...data.groups[existingIndex], ...group, lastSeen: new Date().toISOString() };
    } else {
        data.groups.push({ ...group, firstSeen: new Date().toISOString(), lastSeen: new Date().toISOString() });
    }
    
    saveData(data);
    res.json({ success: true });
});

// API: Mesaj ekle (bot tarafından çağrılacak)
app.post('/api/messages', (req, res) => {
    const data = loadData();
    const message = {
        ...req.body,
        timestamp: new Date().toISOString()
    };
    
    if (!data.messages) {
        data.messages = [];
    }
    
    data.messages.push(message);
    
    // Son 1000 mesajı tut
    if (data.messages.length > 1000) {
        data.messages = data.messages.slice(-1000);
    }
    
    // İstatistikleri güncelle
    if (!data.stats) {
        data.stats = { totalMessages: 0, totalCommands: 0, lastUpdate: null };
    }
    data.stats.totalMessages++;
    if (message.isCommand) {
        data.stats.totalCommands++;
    }
    data.stats.lastUpdate = new Date().toISOString();
    
    saveData(data);
    res.json({ success: true });
});

// Ana sayfa
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin-panel', 'index.html'));
});

// Sunucuyu başlat
app.listen(PORT, () => {
    console.log(`🎛️  Admin paneli çalışıyor: http://localhost:${PORT}`);
    console.log(`📊 Gruplar ve mesajlar burada görüntülenebilir`);
});

