const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');

// Bot ayarları
const config = {
    // Yemek API endpoint'i - Local API sunucusu
    YEMEK_API_URL: process.env.YEMEK_API_URL || 'http://localhost:3000/yemek',
    // Bot numarası (WhatsApp formatında: 905551234567@c.us)
    BOT_NUMBER: process.env.BOT_NUMBER || null, // Otomatik algılanacak
};

// Anti-Ban Koruması Ayarları
const ANTI_BAN_CONFIG = {
    // Mesaj gönderme arası minimum bekleme (milisaniye)
    MIN_MESSAGE_DELAY: 500, // 0.5 saniye (hızlandırıldı)
    MAX_MESSAGE_DELAY: 1000, // 1 saniye (hızlandırıldı)
    
    // Aynı kullanıcıdan/gruptan istekler arası cooldown (saniye)
    USER_COOLDOWN: 3, // 3 saniye (hızlandırıldı)
    GROUP_COOLDOWN: 1, // 1 saniye (hızlandırıldı)
    
    // Günlük mesaj limiti
    DAILY_MESSAGE_LIMIT: 200, // Günde maksimum 200 mesaj (esnetildi)
    
    // Saatlik mesaj limiti
    HOURLY_MESSAGE_LIMIT: 1000, // Saatte maksimum 200 mesaj (esnetildi)
    
    // Spam koruması - aynı kullanıcıdan çok fazla istek
    MAX_REQUESTS_PER_USER_PER_HOUR: 20, // Kullanıcı başına saatte maksimum 20 istek (esnetildi)
};

// Rate limiting ve cooldown tracking
const rateLimiter = {
    // Son mesaj gönderme zamanları
    lastMessageTime: 0,
    
    // Kullanıcı/grup cooldown'ları
    userCooldowns: new Map(), // userId -> timestamp
    groupCooldowns: new Map(), // groupId -> timestamp
    
    // Günlük/saatlik mesaj sayıları
    dailyMessageCount: 0,
    hourlyMessageCount: 0,
    lastHourReset: Date.now(),
    lastDayReset: Date.now(),
    
    // Kullanıcı başına istek sayıları
    userRequestCounts: new Map(), // userId -> {count, resetTime}
    
    // İstek kuyruğu - aynı anda gelen istekleri sıraya koy
    requestQueue: [],
    processingQueue: false,
    
    // Rastgele gecikme ekle (human-like behavior)
    async randomDelay() {
        const delay = ANTI_BAN_CONFIG.MIN_MESSAGE_DELAY + 
                     Math.random() * (ANTI_BAN_CONFIG.MAX_MESSAGE_DELAY - ANTI_BAN_CONFIG.MIN_MESSAGE_DELAY);
        await new Promise(resolve => setTimeout(resolve, delay));
    },
    
    // Cooldown kontrolü
    isOnCooldown(userId, groupId) {
        const now = Date.now();
        
        // Kullanıcı cooldown kontrolü
        if (this.userCooldowns.has(userId)) {
            const lastRequest = this.userCooldowns.get(userId);
            const cooldownTime = ANTI_BAN_CONFIG.USER_COOLDOWN * 1000;
            if (now - lastRequest < cooldownTime) {
                const remaining = Math.ceil((cooldownTime - (now - lastRequest)) / 1000);
                return { onCooldown: true, remaining };
            }
        }
        
        // Grup cooldown kontrolü
        if (this.groupCooldowns.has(groupId)) {
            const lastRequest = this.groupCooldowns.get(groupId);
            const cooldownTime = ANTI_BAN_CONFIG.GROUP_COOLDOWN * 1000;
            if (now - lastRequest < cooldownTime) {
                const remaining = Math.ceil((cooldownTime - (now - lastRequest)) / 1000);
                return { onCooldown: true, remaining };
            }
        }
        
        return { onCooldown: false };
    },
    
    // Cooldown kaydet
    setCooldown(userId, groupId) {
        this.userCooldowns.set(userId, Date.now());
        this.groupCooldowns.set(groupId, Date.now());
    },
    
    // Mesaj limiti kontrolü
    canSendMessage() {
        const now = Date.now();
        
        // Saatlik reset kontrolü
        if (now - this.lastHourReset > 3600000) { // 1 saat
            this.hourlyMessageCount = 0;
            this.lastHourReset = now;
        }
        
        // Günlük reset kontrolü
        if (now - this.lastDayReset > 86400000) { // 24 saat
            this.dailyMessageCount = 0;
            this.lastDayReset = now;
        }
        
        // Limit kontrolü
        if (this.dailyMessageCount >= ANTI_BAN_CONFIG.DAILY_MESSAGE_LIMIT) {
            return { canSend: false, reason: 'Günlük mesaj limiti aşıldı' };
        }
        
        if (this.hourlyMessageCount >= ANTI_BAN_CONFIG.HOURLY_MESSAGE_LIMIT) {
            return { canSend: false, reason: 'Saatlik mesaj limiti aşıldı' };
        }
        
        return { canSend: true };
    },
    
    // Mesaj gönderildi - sayaçları güncelle
    messageSent() {
        this.dailyMessageCount++;
        this.hourlyMessageCount++;
        this.lastMessageTime = Date.now();
    },
    
    // Kullanıcı istek sayısı kontrolü
    canUserRequest(userId) {
        const now = Date.now();
        const userData = this.userRequestCounts.get(userId);
        
        if (!userData || now - userData.resetTime > 3600000) { // 1 saat
            this.userRequestCounts.set(userId, { count: 1, resetTime: now });
            return { canRequest: true };
        }
        
        if (userData.count >= ANTI_BAN_CONFIG.MAX_REQUESTS_PER_USER_PER_HOUR) {
            const remaining = Math.ceil((3600000 - (now - userData.resetTime)) / 60000);
            return { canRequest: false, remaining };
        }
        
        userData.count++;
        return { canRequest: true };
    },
    
    // İstek kuyruğuna ekle ve sırayla işle
    async queueRequest(requestFn) {
        return new Promise((resolve, reject) => {
            this.requestQueue.push({ requestFn, resolve, reject });
            this.processQueue();
        });
    },
    
    // Kuyruğu işle - 1'er saniye arayla
    async processQueue() {
        if (this.processingQueue || this.requestQueue.length === 0) {
            return;
        }
        
        this.processingQueue = true;
        
        while (this.requestQueue.length > 0) {
            const { requestFn, resolve, reject } = this.requestQueue.shift();
            
            try {
                await requestFn();
                resolve();
            } catch (error) {
                reject(error);
            }
            
            // 200ms bekle (son istek değilse) - daha hızlı işleme
            if (this.requestQueue.length > 0) {
                await new Promise(resolve => setTimeout(resolve, 200));
            }
        }
        
        this.processingQueue = false;
    }
};

// Retry sayacı
let retryCount = 0;
const MAX_RETRIES = 5;

// WhatsApp client oluştur
const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: './.wwebjs_auth'
    }),
    puppeteer: {
        headless: true, // Headless sunucu için true (session varsa QR kod göstermez)
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--disable-blink-features=AutomationControlled',
            '--disable-features=IsolateOrigins,site-per-process',
            '--disable-extensions',
            '--disable-software-rasterizer',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--single-process',
            '--disable-xshm',
            '--disable-ipc-flooding-protection',
            '--headless=new',
            '--disable-web-security',
            '--disable-features=VizDisplayCompositor'
        ],
        executablePath: undefined,
        // Daha uzun timeout'lar
        timeout: 60000
    },
    // WhatsApp Web versiyonu - daha eski ve stabil versiyon
    webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
    },
    // Daha uzun session timeout
    takeoverOnConflict: true,
    takeoverTimeoutMs: 60000
});

// QR kod göster
client.on('qr', (qr) => {
    retryCount = 0; // QR kod geldiğinde retry sayacını sıfırla
    console.log('\n═══════════════════════════════════════');
    console.log('📱 BAĞLANTI YÖNTEMİ SEÇİN');
    console.log('═══════════════════════════════════════');
    console.log('\n🔹 YÖNTEM 1: QR Kod ile (Normal)');
    qrcode.generate(qr, { small: true });
    console.log('\n🔹 YÖNTEM 2: Tarayıcıdan Manuel Bağlanma (ÖNERİLEN)');
    console.log('   1. Açılan Chrome penceresinde WhatsApp Web sayfası görünecek');
    console.log('   2. O sayfada normal WhatsApp Web\'e bağlanın (telefonunuzla QR kod tarayın)');
    console.log('   3. Bot otomatik olarak bağlantıyı algılayacak ve session\'ı kaydedecek');
    console.log('   4. Bir sonraki başlatmada otomatik bağlanacak!');
    console.log('\n═══════════════════════════════════════\n');
    
    // 20 saniye sonra QR kod yenilenmezse uyarı ver
    setTimeout(() => {
        if (!client.info) {
            console.log('💡 İPUCU: QR kod yerine açılan Chrome penceresinde manuel bağlanmayı deneyin!');
        }
    }, 20000);
});

// Bağlantı hazır olduğunda
client.on('ready', () => {
    retryCount = 0; // Başarılı bağlantıda retry sayacını sıfırla
    console.log('\n✅✅✅ WhatsApp bot hazır! ✅✅✅');
    console.log('📱 Bot numarası:', client.info.wid.user);
    console.log('🎉 Artık grup mesajlarını dinliyor...\n');
    
    // Bot numarasını config'e kaydet
    if (!config.BOT_NUMBER) {
        config.BOT_NUMBER = `${client.info.wid.user}@c.us`;
    }
});

// Bağlantı hatası
client.on('disconnected', (reason) => {
    console.log('\n❌ WhatsApp bağlantısı kesildi:', reason);
    
    if (retryCount < MAX_RETRIES) {
        retryCount++;
        const waitTime = retryCount * 10000; // Her retry'de 10 saniye daha bekle
        console.log(`🔄 ${waitTime/1000} saniye sonra yeniden bağlanmaya çalışılacak... (Deneme ${retryCount}/${MAX_RETRIES})`);
        setTimeout(() => {
            console.log('🔄 Yeniden bağlanılıyor...');
            client.initialize();
        }, waitTime);
    } else {
        console.log('❌ Maksimum deneme sayısına ulaşıldı. Lütfen botu manuel olarak yeniden başlatın.');
    }
});

// Authentication başarısız
client.on('auth_failure', (msg) => {
    console.error('\n❌ WhatsApp kimlik doğrulama hatası:', msg);
    console.log('\n💡 Çözüm önerileri:');
    console.log('   1. .wwebjs_auth klasörünü silip tekrar deneyin:');
    console.log('      rm -rf .wwebjs_auth .wwebjs_cache');
    console.log('   2. 15-30 dakika bekleyip tekrar deneyin (WhatsApp rate limiting)');
    console.log('   3. Farklı bir internet bağlantısı deneyin');
    console.log('   4. WhatsApp\'ta bekleyen cihaz bağlantılarını kontrol edin');
    console.log('   5. WhatsApp\'ı kapatıp açın\n');
});

// Loading state
client.on('loading_screen', (percent, message) => {
    console.log(`⏳ Yükleniyor: ${percent}% - ${message}`);
});

// Client authentication state
client.on('authenticated', () => {
    console.log('✅ Kimlik doğrulama başarılı!');
});

client.on('authentication', () => {
    console.log('🔐 Kimlik doğrulama yapılıyor...');
});

// Mesaj dinleme
client.on('message', async (message) => {
    try {
        // Sadece grup mesajlarını işle
        const chat = await message.getChat();
        if (!chat.isGroup) {
            return;
        }

        const botNumber = client.info.wid.user;
        const BLOCKED_NUMBER = '5428055983'; // Bu numara etiketlenince bot cevap vermeyecek
        let isMentioned = false;
        
        // 5428055983 numarası etiketlenmişse hiçbir şey yapma
        const messageBody = message.body || '';
        const messageData = message.rawData || {};
        if (messageData.mentionedJid && Array.isArray(messageData.mentionedJid)) {
            const blockedMentioned = messageData.mentionedJid.some(id => {
                const cleanId = id.replace('@c.us', '').replace('@s.whatsapp.net', '').replace('@', '');
                return cleanId === BLOCKED_NUMBER || cleanId.includes(BLOCKED_NUMBER) || id.includes(BLOCKED_NUMBER);
            });
            if (blockedMentioned) {
                console.log(`   ⛔ ${BLOCKED_NUMBER} numarası etiketlendi, cevap verilmeyecek`);
                return;
            }
        }
        
        // Mesaj içeriğinde de kontrol et
        if (messageBody.includes(BLOCKED_NUMBER) || messageBody.includes(`@${BLOCKED_NUMBER}`)) {
            console.log(`   ⛔ ${BLOCKED_NUMBER} numarası mesajda geçiyor, cevap verilmeyecek`);
            return;
        }

        // Mention kontrolü - önce getMentions() dene, hata olursa alternatif yöntem kullan
        try {
            const mentions = await message.getMentions();
            if (mentions && mentions.length > 0) {
                isMentioned = mentions.some(contact => {
                    if (contact && contact.id) {
                        return contact.id.user === botNumber || contact.id._serialized?.includes(botNumber);
                    }
                    return false;
                });
            }
        } catch (mentionError) {
            // Alternatif yöntem: Mesaj verisinden mention kontrolü
            const messageBody = message.body || '';
            const messageData = message.rawData || {};
            
            // Debug: Ham veriyi logla
            console.log(`\n🔍 Mention kontrolü - Grup: ${chat.name}`);
            console.log(`   Bot numarası: ${botNumber}`);
            console.log(`   Mesaj içeriği: ${messageBody.substring(0, 100)}`);
            console.log(`   rawData:`, JSON.stringify(messageData).substring(0, 200));
            
            // WhatsApp'ta mention'lar mesaj verisinde bulunur
            if (messageData.mentionedJid && Array.isArray(messageData.mentionedJid)) {
                console.log(`   mentionedJid bulundu:`, messageData.mentionedJid);
                isMentioned = messageData.mentionedJid.some(id => {
                    const cleanId = id.replace('@c.us', '').replace('@s.whatsapp.net', '').replace('@', '');
                    const botCleanId = botNumber.replace('@c.us', '').replace('@s.whatsapp.net', '').replace('@', '');
                    console.log(`   Karşılaştırma: ${cleanId} === ${botCleanId}?`);
                    return cleanId === botCleanId || id.includes(botNumber) || cleanId.includes(botCleanId);
                });
            }
            
            // Eğer mentionedJid yoksa, mesaj içeriğinde @ işareti veya yemek kelimesi var mı kontrol et
            if (!isMentioned && messageBody) {
                const lowerBody = messageBody.toLowerCase();
                
                // Mention varsa veya yemek/menü kelimesi varsa cevap ver
                if (messageBody.includes('@') || 
                    lowerBody.includes('yemek') || 
                    lowerBody.includes('menü') || 
                    lowerBody.includes('menu') || 
                    lowerBody.includes('ne var') ||
                    lowerBody.includes('bugün ne var')) {
                    console.log(`   ✅ Mention veya yemek kelimesi tespit edildi, cevap verilecek`);
                    isMentioned = true;
                }
            }
            
            console.log(`   Sonuç: Mention = ${isMentioned}\n`);
        }

        if (isMentioned) {
            console.log(`\n📱 Yeni mesaj alındı!`);
            console.log(`   Grup: ${chat.name}`);
            console.log(`   Gönderen: ${message.from}`);
            console.log(`   Mesaj: ${message.body || '(medya mesajı)'}`);
            
            // Anti-ban kontrolleri
            const userId = message.from;
            const groupId = chat.id._serialized || chat.id;
            
            // Kullanıcı istek limiti kontrolü
            const userRequestCheck = rateLimiter.canUserRequest(userId);
            if (!userRequestCheck.canRequest) {
                console.log(`   ⚠️  Rate limit: Kullanıcı çok fazla istek gönderdi. ${userRequestCheck.remaining} dakika bekleyin.`);
                try {
                    await message.reply(`⏳ Çok fazla istek gönderdiniz. Lütfen ${userRequestCheck.remaining} dakika sonra tekrar deneyin.`);
                } catch (e) {
                    // Mesaj gönderilemezse sessizce geç
                }
                return;
            }
            
            // Cooldown kontrolü
            const cooldownCheck = rateLimiter.isOnCooldown(userId, groupId);
            if (cooldownCheck.onCooldown) {
                console.log(`   ⏳ Cooldown: ${cooldownCheck.remaining} saniye kaldı`);
                try {
                    await message.reply(`⏳ Lütfen ${cooldownCheck.remaining} saniye bekleyin.`);
                } catch (e) {
                    // Mesaj gönderilemezse sessizce geç
                }
                return;
            }
            
            // Mesaj limiti kontrolü
            const limitCheck = rateLimiter.canSendMessage();
            if (!limitCheck.canSend) {
                console.log(`   ⚠️  Limit: ${limitCheck.reason}`);
                try {
                    await message.reply(`⚠️ ${limitCheck.reason}. Lütfen daha sonra tekrar deneyin.`);
                } catch (e) {
                    // Mesaj gönderilemezse sessizce geç
                }
                return;
            }
            
            // Cooldown kaydet
            rateLimiter.setCooldown(userId, groupId);
            
            // Mesajdan tarih çıkar
            const tarih = extractTarihFromMessage(message.body || '');
            
            // İsteği kuyruğa ekle ve 1'er saniye arayla işle
            await rateLimiter.queueRequest(async () => {
                await sendYemekBilgisi(chat, message, tarih);
            });
        }
    } catch (error) {
        console.error('❌ Mesaj işleme hatası:', error.message);
        // Hata olsa bile devam et
    }
});

// Mesajdan tarih çıkar (yarın, pazartesi, 10 aralık, vs.)
function extractTarihFromMessage(messageBody) {
    if (!messageBody) return null;
    
    const lowerBody = messageBody.toLowerCase().trim();
    const today = new Date();
    const gunler = ['pazar', 'pazartesi', 'salı', 'çarşamba', 'perşembe', 'cuma', 'cumartesi'];
    const aylar = ['ocak', 'şubat', 'mart', 'nisan', 'mayıs', 'haziran', 
                   'temmuz', 'ağustos', 'eylül', 'ekim', 'kasım', 'aralık'];
    
    // "yarın" kontrolü
    if (lowerBody.includes('yarın') || lowerBody.includes('yarn')) {
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        return tomorrow.toISOString().split('T')[0];
    }
    
    // "bugün" kontrolü
    if (lowerBody.includes('bugün') || lowerBody.includes('bugun')) {
        return today.toISOString().split('T')[0];
    }
    
    // Gün isimleri kontrolü (pazartesi, salı, vs.)
    for (let i = 0; i < gunler.length; i++) {
        if (lowerBody.includes(gunler[i])) {
            const targetDay = i; // 0 = Pazar, 1 = Pazartesi, vs.
            const currentDay = today.getDay();
            let daysToAdd = targetDay - currentDay;
            
            // Eğer bugünden önceki bir gün isteniyorsa, gelecek haftaya al
            if (daysToAdd <= 0) {
                daysToAdd += 7;
            }
            
            const targetDate = new Date(today);
            targetDate.setDate(targetDate.getDate() + daysToAdd);
            return targetDate.toISOString().split('T')[0];
        }
    }
    
    // Tarih formatı kontrolü (10 aralık, 15 ocak, vs.)
    for (let i = 0; i < aylar.length; i++) {
        const ayAdi = aylar[i];
        if (lowerBody.includes(ayAdi)) {
            // Ay adını bul, önündeki sayıyı al
            const ayIndex = lowerBody.indexOf(ayAdi);
            const beforeAy = lowerBody.substring(Math.max(0, ayIndex - 15), ayIndex).trim();
            
            // En son sayıyı bul (gün numarası) - sadece ay adından önceki sayıyı al
            const gunMatch = beforeAy.match(/(\d{1,2})\s*$/);
            if (gunMatch) {
                const gun = parseInt(gunMatch[1]);
                
                if (gun >= 1 && gun <= 31) {
                    const yil = today.getFullYear();
                    const ay = i + 1; // JavaScript'te ay 0-11 arası
                    
                    // Tarihi string olarak oluştur (timezone sorunlarını önlemek için)
                    const tarihStr = `${yil}-${String(ay).padStart(2, '0')}-${String(gun).padStart(2, '0')}`;
                    
                    // Tarih geçerli mi kontrol et
                    const testDate = new Date(tarihStr + 'T12:00:00');
                    if (testDate.getDate() === gun && testDate.getMonth() === (ay - 1) && testDate.getFullYear() === yil) {
                        // Bugünün tarihini al (sadece tarih kısmı)
                        const todayStr = today.toISOString().split('T')[0];
                        const todayMonth = today.getMonth() + 1; // 1-12 arası
                        
                        // Eğer geçmiş bir tarihse:
                        // - Bu ay içindeyse bu yıl kullan (geçmiş olsa bile)
                        // - Geçmiş bir ay ise gelecek yıla al
                        if (tarihStr < todayStr) {
                            if (ay < todayMonth) {
                                // Geçmiş bir ay ise gelecek yıla al
                                const nextYear = yil + 1;
                                const nextTarihStr = `${nextYear}-${String(ay).padStart(2, '0')}-${String(gun).padStart(2, '0')}`;
                                console.log(`   📅 Tarih parse edildi: "${messageBody}" -> ${nextTarihStr} (gelecek yıl - geçmiş ay)`);
                                return nextTarihStr;
                            } else {
                                // Bu ay içinde ama geçmiş bir tarih - bu yıl kullan
                                console.log(`   📅 Tarih parse edildi: "${messageBody}" -> ${tarihStr} (bu ay - geçmiş tarih)`);
                                return tarihStr;
                            }
                        }
                        
                        console.log(`   📅 Tarih parse edildi: "${messageBody}" -> ${tarihStr}`);
                        return tarihStr;
                    }
                }
            }
        }
    }
    
    // YYYY-MM-DD formatı kontrolü
    const dateMatch = messageBody.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (dateMatch) {
        return dateMatch[0];
    }
    
    // DD.MM.YYYY veya DD/MM/YYYY formatı
    const dateMatch2 = messageBody.match(/(\d{1,2})[.\/](\d{1,2})[.\/]?(\d{4})?/);
    if (dateMatch2) {
        const gun = parseInt(dateMatch2[1]);
        const ay = parseInt(dateMatch2[2]);
        const yil = dateMatch2[3] ? parseInt(dateMatch2[3]) : today.getFullYear();
        
        const targetDate = new Date(yil, ay - 1, gun);
        if (targetDate < today && !dateMatch2[3]) {
            targetDate.setFullYear(yil + 1);
        }
        
        return targetDate.toISOString().split('T')[0];
    }
    
    return null; // Tarih bulunamadı, bugün kullanılacak
}

// Yemek bilgisini API'den çek ve gönder
async function sendYemekBilgisi(chat, message, requestedTarih = null) {
    try {
        // Rate limiting - mesaj göndermeden önce rastgele bekle
        await rateLimiter.randomDelay();
        
        // "Yükleniyor..." mesajı gönder
        let loadingMsg;
        try {
            loadingMsg = await message.reply('🍽️ Yemek menüsü getiriliyor...');
            rateLimiter.messageSent(); // Mesaj sayacını güncelle
        } catch (sendError) {
            console.error('⚠️  Mesaj gönderme hatası (rate limit olabilir):', sendError.message);
            // Hata durumunda sessizce geç, tekrar deneme
            return;
        }

        // Tarih belirleme: İstenen tarih varsa onu kullan, yoksa bugün
        const today = new Date();
        const dateStr = requestedTarih || today.toISOString().split('T')[0];
        
        if (requestedTarih) {
            console.log(`📅 İstenen tarih: ${requestedTarih}`);
        } else {
            console.log(`📅 Bugünün tarihi kullanılıyor: ${dateStr}`);
        }
        
        // API'den hem kahvaltı hem akşam yemeğini çek
        let kahvaltiBilgisi = null;
        let aksamBilgisi = null;
        let veriBulundu = false;
        
        try {
            // Kahvaltı
            try {
                const kahvaltiResponse = await axios.get(config.YEMEK_API_URL, {
                    params: {
                        tarih: dateStr,
                        sehir: 'balikesir',
                        ogun: 'kahvalti'
                    },
                    timeout: 10000
                });
                kahvaltiBilgisi = kahvaltiResponse.data;
                // Eğer yemekler varsa ve tarih eşleşiyorsa veri bulundu
                if (kahvaltiBilgisi && kahvaltiBilgisi.yemekler && kahvaltiBilgisi.yemekler.length > 0) {
                    // Tarih kontrolü - API'den dönen tarih istenen tarihle eşleşmeli
                    if (kahvaltiBilgisi.tarih === dateStr) {
                        veriBulundu = true;
                    } else {
                        console.log(`⚠️  Tarih eşleşmiyor: İstenen: ${dateStr}, Dönen: ${kahvaltiBilgisi.tarih}`);
                        kahvaltiBilgisi = null; // Veriyi geçersiz say
                    }
                }
            } catch (e) {
                // 404 hatası ise veri yok demektir
                if (e.response && e.response.status === 404) {
                    console.log('⚠️  Kahvaltı bilgisi bulunamadı (404)');
                } else {
                    console.log('⚠️  Kahvaltı bilgisi alınamadı:', e.message);
                    // Diğer hatalarda da veri yok sayılabilir
                }
            }
            
            // Akşam yemeği
            try {
                const aksamResponse = await axios.get(config.YEMEK_API_URL, {
                    params: {
                        tarih: dateStr,
                        sehir: 'balikesir',
                        ogun: 'aksam'
                    },
                    timeout: 10000
                });
                aksamBilgisi = aksamResponse.data;
                // Eğer yemekler varsa ve tarih eşleşiyorsa veri bulundu
                if (aksamBilgisi && aksamBilgisi.yemekler && aksamBilgisi.yemekler.length > 0) {
                    // Tarih kontrolü - API'den dönen tarih istenen tarihle eşleşmeli
                    if (aksamBilgisi.tarih === dateStr) {
                        veriBulundu = true;
                    } else {
                        console.log(`⚠️  Tarih eşleşmiyor: İstenen: ${dateStr}, Dönen: ${aksamBilgisi.tarih}`);
                        aksamBilgisi = null; // Veriyi geçersiz say
                    }
                }
            } catch (e) {
                // 404 hatası ise veri yok demektir
                if (e.response && e.response.status === 404) {
                    console.log('⚠️  Akşam yemeği bilgisi bulunamadı (404)');
                } else {
                    console.log('⚠️  Akşam yemeği bilgisi alınamadı:', e.message);
                    // Diğer hatalarda da veri yok sayılabilir
                }
            }
            
        } catch (apiError) {
            console.error('API hatası:', apiError.message);
        }

        // Eğer hiç veri bulunamadıysa ve özel bir tarih istenmişse
        if (!veriBulundu && requestedTarih) {
            try {
                if (loadingMsg) {
                    await loadingMsg.delete();
                }
                await chat.sendMessage('sıçma amk daha eklemedik veriyi');
                rateLimiter.messageSent();
                console.log(`   ⚠️  Veri bulunamadı, uyarı mesajı gönderildi`);
                return;
            } catch (sendError) {
                console.error('⚠️  Uyarı mesajı gönderme hatası:', sendError.message);
            }
        }

        // Mesajı formatla (hem kahvaltı hem akşam)
        const mesaj = formatYemekMesaji(kahvaltiBilgisi, aksamBilgisi, dateStr, requestedTarih);
        
        // Rate limiting - mesaj göndermeden önce tekrar rastgele bekle
        await rateLimiter.randomDelay();
        
        // Loading mesajını sil ve yeni mesajı gönder
        try {
            if (loadingMsg) {
                await loadingMsg.delete();
            }
            
            await chat.sendMessage(mesaj);
            rateLimiter.messageSent(); // Mesaj sayacını güncelle
            
            console.log(`   ✅ Mesaj başarıyla gönderildi`);
            console.log(`   📊 Günlük: ${rateLimiter.dailyMessageCount}/${ANTI_BAN_CONFIG.DAILY_MESSAGE_LIMIT}, Saatlik: ${rateLimiter.hourlyMessageCount}/${ANTI_BAN_CONFIG.HOURLY_MESSAGE_LIMIT}`);
        } catch (sendError) {
            console.error('⚠️  Mesaj gönderme hatası:', sendError.message);
            // Hata durumunda sessizce geç, spam gibi görünmesin
            if (sendError.message.includes('rate') || sendError.message.includes('limit')) {
                console.log('   ⚠️  Rate limit tespit edildi, mesaj gönderilmedi');
            }
        }
        
    } catch (error) {
        console.error('❌ Yemek bilgisi gönderme hatası:', error.message);
        
        // Hata durumunda çok fazla mesaj gönderme (spam gibi görünmesin)
        // Sadece kritik hatalarda kullanıcıya bilgi ver
        if (error.message.includes('rate') || error.message.includes('limit')) {
            console.log('   ⚠️  Rate limit hatası, sessizce geçiliyor');
            return; // Sessizce geç, tekrar deneme
        }
        
        // Diğer hatalar için de dikkatli ol
        try {
            await rateLimiter.randomDelay();
            await message.reply('❌ Yemek bilgisi alınırken bir hata oluştu. Lütfen daha sonra tekrar deneyin.');
            rateLimiter.messageSent();
        } catch (replyError) {
            // Mesaj gönderilemezse sessizce geç
            console.log('   ⚠️  Hata mesajı gönderilemedi, sessizce geçiliyor');
        }
    }
}

// Yemek mesajını formatla (hem kahvaltı hem akşam)
function formatYemekMesaji(kahvaltiBilgisi, aksamBilgisi, tarih, requestedTarih = null) {
    const tarihObj = new Date(tarih);
    const gunler = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
    const aylar = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 
                   'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
    
    const gunAdi = gunler[tarihObj.getDay()];
    const gun = tarihObj.getDate();
    const ay = aylar[tarihObj.getMonth()];
    const yil = tarihObj.getFullYear();
    
    // Eğer özel bir tarih istenmişse belirt
    let tarihBilgisi = '';
    if (requestedTarih) {
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];
        if (requestedTarih === todayStr) {
            tarihBilgisi = ' (Bugün)';
        } else {
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);
            const tomorrowStr = tomorrow.toISOString().split('T')[0];
            if (requestedTarih === tomorrowStr) {
                tarihBilgisi = ' (Yarın)';
            }
        }
    }
    
    let mesaj = `🍽️ *${gunAdi}, ${gun} ${ay} ${yil} Yemek Menüsü${tarihBilgisi}*\n`;
    mesaj += `━━━━━━━━━━━━━━━━━━━━\n\n`;
    
    // Kahvaltı bölümü
    if (kahvaltiBilgisi && kahvaltiBilgisi.yemekler && kahvaltiBilgisi.yemekler.length > 0) {
        mesaj += `🌤️ *KAHVALTI*\n`;
        kahvaltiBilgisi.yemekler.forEach((yemek, index) => {
            mesaj += `${index + 1}. ${yemek}\n`;
        });
        mesaj += `\n`;
    } else {
        mesaj += `🌤️ *KAHVALTI*\n`;
        mesaj += `⚠️ Kahvaltı menüsü bulunamadı\n\n`;
    }
    
    mesaj += `━━━━━━━━━━━━━━━━━━━━\n\n`;
    
    // Akşam yemeği bölümü
    if (aksamBilgisi && aksamBilgisi.yemekler && aksamBilgisi.yemekler.length > 0) {
        mesaj += `🌙 *AKŞAM YEMEĞİ*\n`;
        aksamBilgisi.yemekler.forEach((yemek, index) => {
            mesaj += `${index + 1}. ${yemek}\n`;
        });
    } else {
        mesaj += `🌙 *AKŞAM YEMEĞİ*\n`;
        mesaj += `⚠️ Akşam yemeği menüsü bulunamadı\n`;
    }
    
    // Hata notu varsa ekle
    if (kahvaltiBilgisi && kahvaltiBilgisi.not) {
        mesaj += `\n\n⚠️ ${kahvaltiBilgisi.not}`;
    }
    if (aksamBilgisi && aksamBilgisi.not) {
        mesaj += `\n\n⚠️ ${aksamBilgisi.not}`;
    }
    
    // Geliştirici bilgisi
    mesaj += `\n\n━━━━━━━━━━━━━━━━━━━━\n`;
    mesaj += `@5428055983 (Tuna Karataş) tarafından geliştirilmiştir.`;
    
    return mesaj;
}

// Botu başlat
console.log('\n═══════════════════════════════════════');
console.log('🚀 WhatsApp Bot Başlatılıyor...');
console.log('═══════════════════════════════════════\n');
console.log('📋 Durum:');
console.log('   - Chrome penceresi açılacak');
console.log('   - WhatsApp Web sayfası yüklenecek');
console.log('   - Bağlantı kurulduğunda burada mesaj göreceksiniz\n');
console.log('💡 İPUCU: Chrome penceresinde WhatsApp Web\'e manuel olarak bağlanabilirsiniz!\n');

// Başlatma fonksiyonu
function startBot() {
    try {
        console.log('⏳ Bot başlatılıyor...');
        client.initialize().catch(err => {
            console.error('\n❌ Bot başlatma hatası:', err);
            console.log('🔄 10 saniye sonra tekrar denenecek...\n');
            setTimeout(() => {
                startBot();
            }, 10000);
        });
    } catch (error) {
        console.error('\n❌ Kritik hata:', error);
        console.log('\n💡 Çözüm:');
        console.log('   1. Chrome penceresinin açıldığını kontrol edin');
        console.log('   2. WhatsApp Web sayfasının yüklendiğini kontrol edin');
        console.log('   3. Botu yeniden başlatın: npm start\n');
        process.exit(1);
    }
}

startBot();

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n⏹️  Bot kapatılıyor...');
    await client.destroy();
    process.exit(0);
});

