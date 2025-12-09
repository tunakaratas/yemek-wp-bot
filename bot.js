const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');

// Admin panel API URL
const ADMIN_API_URL = process.env.ADMIN_API_URL || 'http://localhost:3001';

// Admin paneline veri gönder
async function sendToAdminPanel(endpoint, data) {
    try {
        await axios.post(`${ADMIN_API_URL}/api/${endpoint}`, data, { timeout: 1000 });
    } catch (error) {
        // Admin panel çalışmıyorsa sessizce geç
    }
}

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
    console.log('🎉 Artık grup ve özel mesajları dinliyor...\n');
    
    // Bot numarasını config'e kaydet
    if (!config.BOT_NUMBER) {
        config.BOT_NUMBER = `${client.info.wid.user}@c.us`;
    }
    
    // Günlük bildirim sistemini başlat
    startDailyNotifications();
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
// Admin paneline veri gönder
async function sendToAdminPanel(endpoint, data) {
    try {
        await axios.post(`${ADMIN_API_URL}/api/${endpoint}`, data, { timeout: 1000 });
    } catch (error) {
        // Admin panel çalışmıyorsa sessizce geç
    }
}

client.on('message', async (message) => {
    try {
        // Grup ve özel mesajları işle
        const chat = await message.getChat();
        const isGroup = chat.isGroup;
        const isPrivate = !isGroup;
        
        // Özel mesajlarda mention kontrolü gerekmez, direkt komut veya mesaj içeriğine bak
        if (isPrivate) {
            console.log(`📩 Özel mesaj alındı: ${message.from}`);
        }
        
        const botNumber = client.info.wid.user;
        const botNumberClean = botNumber.replace('@c.us', '').replace('@s.whatsapp.net', '').replace('@', '');
        const BLOCKED_NUMBER = '5428055983'; // Bu numara etiketlenince bot cevap vermeyecek
        let isMentioned = false;
        
        const messageBody = message.body || '';
        const rawMessageData = message.rawData || {};
        
        // Admin paneline mesaj kaydet
        const adminMessageData = {
            from: message.from,
            body: message.body || '(medya mesajı)',
            isGroup: isGroup,
            groupName: isGroup ? chat.name : null,
            groupId: isGroup ? (chat.id._serialized || chat.id) : null,
            isCommand: false,
            timestamp: new Date().toISOString()
        };
        
        // Grup bilgisini admin paneline gönder
        if (isGroup) {
            await sendToAdminPanel('groups', {
                id: chat.id._serialized || chat.id,
                name: chat.name || 'İsimsiz Grup'
            });
        }
        
        // EN ÖNCE komut kontrolü yap (her şeyden önce!)
        // Mesajdan mention'ı temizle ve sadece komutu kontrol et
        let cleanMessageBody = messageBody;
        // Mention'ları temizle (örneğin "@231868775555151 help" -> "help")
        // Önce @ işaretinden sonraki tüm sayıları temizle
        cleanMessageBody = cleanMessageBody.replace(/@\d+/g, '').trim();
        // Birden fazla boşluk varsa tek boşluğa çevir
        cleanMessageBody = cleanMessageBody.replace(/\s+/g, ' ').trim();
        
        console.log(`\n🔍 Komut kontrolü başlatılıyor...`);
        console.log(`   Orijinal mesaj: "${messageBody}"`);
        console.log(`   Temizlenmiş mesaj: "${cleanMessageBody}"`);
        
        const command = parseCommand(cleanMessageBody);
        
        // Komut varsa işaretle
        if (command) {
            adminMessageData.isCommand = true;
        }
        
        // Admin paneline mesajı gönder (async, hata olsa bile devam et)
        sendToAdminPanel('messages', adminMessageData).catch(() => {});
        
        // Eğer komut yoksa ama mesaj tek kelime ve BOT mention edilmişse, bilinmeyen komut olabilir
        // ÖNCE mention kontrolü yap, sonra bilinmeyen komut kontrolü yap
        let isMentionedForUnknown = false;
        if (!command && cleanMessageBody && !cleanMessageBody.includes(' ')) {
            // Önce mention kontrolü yap - SADECE BOT mention edilmişse devam et
            try {
                const mentions = await message.getMentions();
                if (mentions && mentions.length > 0) {
                    isMentionedForUnknown = mentions.some(contact => {
                        if (contact && contact.id) {
                            // SADECE TAM EŞLEŞME - başka numaraları eşleştirmemek için
                            return contact.id.user === botNumber;
                        }
                        return false;
                    });
                }
            } catch (mentionError) {
                if (rawMessageData.mentionedJid && Array.isArray(rawMessageData.mentionedJid)) {
                    isMentionedForUnknown = rawMessageData.mentionedJid.some(id => {
                        const cleanId = id.replace('@c.us', '').replace('@s.whatsapp.net', '').replace('@', '');
                        const botCleanId = botNumber.replace('@c.us', '').replace('@s.whatsapp.net', '').replace('@', '');
                        // SADECE TAM EŞLEŞME - başka numaraları eşleştirmemek için
                        return cleanId === botCleanId;
                    });
                }
            }
        }
        
        if (!command && cleanMessageBody && !cleanMessageBody.includes(' ') && isMentionedForUnknown) {
            // Tek kelime ve BOT mention edilmiş - bilinmeyen komut olabilir
            console.log(`\n⚠️  Bilinmeyen komut tespit edildi: "${cleanMessageBody}"`);
            
            if (isMentionedForUnknown) {
                try {
                    await message.reply(`⚠️ Bilinmeyen komut: "${cleanMessageBody}"\n\n📋 Kullanılabilir komutlar:\n• help - Yardım\n• menu - Bugünün menüsü\n• yarın - Yarının menüsü\n• haftalık - Haftalık menü\n\n💡 İPUCU: Sadece botu etiketlemek de yeterli! (@bot)\nTüm komutlar için: @bot help`);
                    rateLimiter.messageSent();
                } catch (e) {
                    console.error('⚠️  Bilinmeyen komut uyarısı gönderilemedi:', e.message);
                }
                return;
            }
        }
        
        if (command) {
            console.log(`\n🔍 Komut tespit edildi: ${command}`);
            console.log(`   Orijinal mesaj: ${messageBody}`);
            console.log(`   Temizlenmiş mesaj: ${cleanMessageBody}`);
            
            // Komut varsa mention kontrolü yap (özel mesajlarda mention gerekmez)
            let isMentionedForCommand = false;
            
            // Özel mesajlarda mention kontrolü gerekmez, direkt komut işlenir
            if (isPrivate) {
                isMentionedForCommand = true;
                console.log(`   ✅ Özel mesaj - mention kontrolü atlandı`);
            } else {
                // Grup mesajlarında mention kontrolü yap
                // Mention kontrolü - önce getMentions() dene, sonra alternatif yöntem
                try {
                    const mentions = await message.getMentions();
                    console.log(`   getMentions() sonucu:`, mentions?.length || 0, 'mention');
                    if (mentions && mentions.length > 0) {
                        mentions.forEach(contact => {
                            if (contact && contact.id) {
                                const contactUser = contact.id.user || '';
                                console.log(`   Mention kontrolü: contact.user=${contactUser}, botNumber=${botNumber}`);
                                // SADECE TAM EŞLEŞME - başka numaraları eşleştirmemek için
                                if (contactUser === botNumber) {
                                    isMentionedForCommand = true;
                                    console.log(`   ✅ getMentions() ile eşleşme bulundu!`);
                                }
                            }
                        });
                    }
                } catch (mentionError) {
                    console.log(`   getMentions() hatası, alternatif yöntem deneniyor...`);
                }
                
                // Alternatif yöntem: Mesaj verisinden mention kontrolü (her zaman kontrol et)
                if (!isMentionedForCommand && rawMessageData.mentionedJid && Array.isArray(rawMessageData.mentionedJid)) {
                    console.log(`   Alternatif yöntem: mentionedJid kontrol ediliyor...`);
                    console.log(`   mentionedJid:`, rawMessageData.mentionedJid);
                    console.log(`   Bot numarası: ${botNumber}`);
                    isMentionedForCommand = rawMessageData.mentionedJid.some(id => {
                        const cleanId = id.replace('@c.us', '').replace('@s.whatsapp.net', '').replace('@', '');
                        const botCleanId = botNumber.replace('@c.us', '').replace('@s.whatsapp.net', '').replace('@', '');
                        console.log(`   Karşılaştırma: cleanId=${cleanId}, botCleanId=${botCleanId}`);
                        // SADECE TAM EŞLEŞME - başka numaraları eşleştirmemek için
                        const match = cleanId === botCleanId;
                        if (match) console.log(`   ✅ Alternatif yöntem ile eşleşme bulundu!`);
                        return match;
                    });
                }
            }
            
            console.log(`   Mention kontrolü sonucu: ${isMentionedForCommand}`);
            
            if (isMentionedForCommand) {
                console.log(`   ✅ Bot mention edildi, komut işlenecek`);
                
                // Anti-ban kontrolleri (komutlar için de geçerli)
                const userId = message.from;
                const groupId = chat.id._serialized || chat.id;
                
                // Kullanıcı istek limiti kontrolü
                const userRequestCheck = rateLimiter.canUserRequest(userId);
                if (!userRequestCheck.canRequest) {
                    console.log(`   ⚠️  Rate limit: Kullanıcı çok fazla istek gönderdi.`);
                    try {
                        await message.reply(`⏳ Çok fazla istek gönderdiniz. Lütfen ${userRequestCheck.remaining} dakika sonra tekrar deneyin.`);
                    } catch (e) {
                        // Mesaj gönderilemezse sessizce geç
                    }
                    return;
                }
                
                // Cooldown kontrolü (komutlar için daha kısa, help için hiç yok)
                const cooldownCheck = rateLimiter.isOnCooldown(userId, groupId);
                if (cooldownCheck.onCooldown && command !== 'help') {
                    console.log(`   ⏳ Cooldown: ${cooldownCheck.remaining} saniye kaldı`);
                    try {
                        await message.reply(`⏳ Lütfen ${cooldownCheck.remaining} saniye bekleyin.`);
                    } catch (e) {
                        // Mesaj gönderilemezse sessizce geç
                    }
                    return;
                }
                
                // Komutu işle
                console.log(`   🚀 Komut işleniyor: ${command}`);
                await handleCommand(chat, message, command);
                rateLimiter.setCooldown(userId, groupId);
                return; // Komut işlendi, normal akışa devam etme
            } else {
                console.log(`   ⚠️  Komut var ama bot mention edilmedi, komut işlenmeyecek`);
                return; // Komut var ama mention yok, hiçbir şey yapma
            }
        }
        
        // 5428055983 numarası etiketlenmişse hiçbir şey yapma
        if (rawMessageData.mentionedJid && Array.isArray(rawMessageData.mentionedJid)) {
            const blockedMentioned = rawMessageData.mentionedJid.some(id => {
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

        // Komut yoksa normal mention kontrolü yap (özel mesajlarda mention gerekmez)
        if (isPrivate) {
            // Özel mesajlarda: Herhangi bir mesaj yazılırsa help göster
            // Eğer yemek/menü kelimesi varsa veya tarih sorgusu varsa direkt menü göster
            const lowerBody = messageBody.toLowerCase();
            const tarih = extractTarihFromMessage(messageBody);
            
            if (lowerBody.includes('yemek') || 
                lowerBody.includes('menü') || 
                lowerBody.includes('menu') || 
                lowerBody.includes('ne var') ||
                lowerBody.includes('bugün ne var') ||
                tarih !== null) { // Tarih sorgusu varsa da menü göster
                isMentioned = true;
                if (tarih !== null) {
                    console.log(`   ✅ Özel mesaj - tarih sorgusu tespit edildi (${tarih}), menü gösterilecek`);
                    // Tarih sorgusu varsa direkt menü göster (mention kontrolüne gerek yok)
                    const userId = message.from;
                    const groupId = chat.id._serialized || chat.id;
                    
                    const userRequestCheck = rateLimiter.canUserRequest(userId);
                    if (!userRequestCheck.canRequest) {
                        console.log(`   ⚠️  Rate limit: Kullanıcı çok fazla istek gönderdi.`);
                        try {
                            await message.reply(`⏳ Çok fazla istek gönderdiniz. Lütfen ${userRequestCheck.remaining} dakika sonra tekrar deneyin.`);
                        } catch (e) { }
                        return;
                    }
                    
                    const cooldownCheck = rateLimiter.isOnCooldown(userId, groupId);
                    if (cooldownCheck.onCooldown) {
                        console.log(`   ⏳ Cooldown: ${cooldownCheck.remaining} saniye kaldı`);
                        try {
                            await message.reply(`⏳ Lütfen ${cooldownCheck.remaining} saniye bekleyin.`);
                        } catch (e) { }
                        return;
                    }
                    
                    await rateLimiter.queueRequest(async () => {
                        await sendYemekBilgisi(chat, message, tarih);
                    });
                    rateLimiter.setCooldown(userId, groupId);
                    return; // Tarih sorgusu işlendi, normal akışa devam etme
                } else {
                    console.log(`   ✅ Özel mesaj - yemek/menü kelimesi tespit edildi, menü gösterilecek`);
                }
            } else if (messageBody.trim().length > 0) {
                // Herhangi bir mesaj yazıldıysa help göster
                console.log(`   ✅ Özel mesaj - herhangi bir mesaj yazıldı, help gösterilecek`);
                await sendPrivateHelpMessage(chat, message, false);
                rateLimiter.setCooldown(message.from, chat.id._serialized || chat.id);
                return;
            }
        } else {
            // Grup mesajlarında mention kontrolü yap
            console.log(`\n🔍 Mention kontrolü - Grup: ${chat.name}`);
            console.log(`   Bot numarası: ${botNumber} (temiz: ${botNumberClean})`);
            console.log(`   Mesaj içeriği: ${messageBody.substring(0, 100)}`);
            
            // 1. Önce rawMessageData.mentionedJid'den kontrol et
            if (rawMessageData && rawMessageData.mentionedJid && Array.isArray(rawMessageData.mentionedJid)) {
                console.log(`   ✅ mentionedJid bulundu:`, rawMessageData.mentionedJid);
                isMentioned = rawMessageData.mentionedJid.some(id => {
                    // Farklı formatları normalize et
                    let cleanId = id.toString();
                    cleanId = cleanId.replace('@c.us', '').replace('@s.whatsapp.net', '').replace('@', '');
                    cleanId = cleanId.replace(/[^\d]/g, ''); // Sadece rakamları al
                    
                    console.log(`   Karşılaştırma: cleanId="${cleanId}", botNumberClean="${botNumberClean}"`);
                    
                    // Tam eşleşme veya numara içinde geçiyor mu kontrol et
                    const match = cleanId === botNumberClean || cleanId.includes(botNumberClean) || botNumberClean.includes(cleanId);
                    if (match) {
                        console.log(`   ✅✅✅ mentionedJid ile eşleşme bulundu! ✅✅✅`);
                    } else {
                        console.log(`   ❌ Eşleşme yok: ${cleanId} !== ${botNumberClean}`);
                    }
                    return match;
                });
            }
            
            // 2. Eğer mentionedJid ile bulunamadıysa, getMentions() dene
            if (!isMentioned) {
                try {
                    const mentions = await message.getMentions();
                    console.log(`   getMentions() sonucu:`, mentions?.length || 0, 'mention');
                    if (mentions && mentions.length > 0) {
                        isMentioned = mentions.some(contact => {
                            if (contact && contact.id) {
                                let contactUser = contact.id.user || '';
                                let contactSerialized = contact.id._serialized || '';
                                
                                // Her iki formattan da temiz numarayı çıkar
                                let contactClean = contactUser.toString().replace(/[^\d]/g, '');
                                if (!contactClean && contactSerialized) {
                                    contactClean = contactSerialized.replace('@c.us', '').replace('@s.whatsapp.net', '').replace(/[^\d]/g, '');
                                }
                                
                                console.log(`   Mention kontrolü: contactClean="${contactClean}", botNumberClean="${botNumberClean}"`);
                                
                                // Tam eşleşme kontrolü
                                const match = contactClean === botNumberClean || contactClean.includes(botNumberClean) || botNumberClean.includes(contactClean);
                                if (match) {
                                    console.log(`   ✅✅✅ getMentions() ile eşleşme bulundu! ✅✅✅`);
                                    return true;
                                } else {
                                    console.log(`   ❌ Eşleşme yok: ${contactClean} !== ${botNumberClean}`);
                                }
                            }
                            return false;
                        });
                    }
                } catch (mentionError) {
                    console.log(`   getMentions() hatası:`, mentionError.message);
                }
            }
            
            // 3. Son çare: Mesaj içeriğinde bot numarası geçiyor mu kontrol et
            if (!isMentioned && messageBody.includes('@')) {
                // Mesaj içinde bot numarası geçiyor mu? (farklı formatlar)
                // Örnek: @905335445983, @5335445983, 905335445983, 5335445983
                const botNumberVariants = [
                    botNumberClean, // 905335445983
                    botNumberClean.replace(/^90/, ''), // 5335445983 (90 kaldırılmış)
                    botNumberClean.replace(/^905/, ''), // 335445983 (905 kaldırılmış)
                ];
                
                // Mesaj içinde bu numaralardan biri geçiyor mu?
                const hasBotMention = botNumberVariants.some(num => {
                    // @ ile başlayan mention kontrolü
                    const mentionPattern = `@${num}`;
                    const hasMention = messageBody.includes(mentionPattern) || 
                                      messageBody.toLowerCase().includes(mentionPattern.toLowerCase());
                    
                    if (hasMention) {
                        console.log(`   ✅ Mesaj içeriğinde bot numarası mention'ı bulundu: ${mentionPattern}`);
                        return true;
                    }
                    return false;
                });
                
                if (hasBotMention) {
                    isMentioned = true;
                } else {
                    console.log(`   ⚠️  Mesaj içeriğinde bot numarası bulunamadı`);
                }
            }
            
            // 4. rawMessageData'yı daha detaylı kontrol et
            if (!isMentioned && rawMessageData) {
                console.log(`   🔍 rawMessageData detaylı kontrol:`, JSON.stringify(rawMessageData).substring(0, 500));
                // Farklı alanlarda mention bilgisi olabilir
                const possibleMentionFields = [
                    rawMessageData.mentionedJid,
                    rawMessageData.mentionedJidList,
                    rawMessageData.mentionedJids,
                    rawMessageData.mentions,
                ];
                
                for (const field of possibleMentionFields) {
                    if (Array.isArray(field) && field.length > 0) {
                        console.log(`   ✅ Alternatif mention alanı bulundu:`, field);
                        const found = field.some(id => {
                            let cleanId = id.toString().replace(/[^\d]/g, '');
                            const match = cleanId === botNumberClean || cleanId.includes(botNumberClean) || botNumberClean.includes(cleanId);
                            if (match) {
                                console.log(`   ✅✅✅ Alternatif alanda eşleşme bulundu! ✅✅✅`);
                            }
                            return match;
                        });
                        if (found) {
                            isMentioned = true;
                            break;
                        }
                    }
                }
            }
            
            console.log(`   🔍🔍🔍 SONUÇ: Mention = ${isMentioned} 🔍🔍🔍\n`);
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

// Komut parse etme
function parseCommand(messageBody) {
    if (!messageBody) return null;
    
    const trimmedBody = messageBody.trim();
    const lowerBody = trimmedBody.toLowerCase();
    
    // Komut kontrolü (slash olmadan, sadece kelime olarak)
    // Tam eşleşme kontrolü (başında ve sonunda boşluk veya mesaj sonu)
    if (lowerBody === 'start' || lowerBody === 'başla' || lowerBody.startsWith('start ') || lowerBody.startsWith('başla ')) {
        return 'start';
    }
    if (lowerBody === 'help' || lowerBody === 'yardım' || lowerBody === 'komut' || lowerBody.startsWith('help ') || lowerBody.startsWith('yardım ') || lowerBody.startsWith('komut ')) {
        return 'help';
    }
    if (lowerBody === 'menu' || lowerBody === 'menü' || lowerBody.startsWith('menu ') || lowerBody.startsWith('menü ')) {
        return 'menu';
    }
    if (lowerBody === 'today' || lowerBody === 'bugün' || lowerBody === 'bugun' || lowerBody.startsWith('today ') || lowerBody.startsWith('bugün ') || lowerBody.startsWith('bugun ')) {
        return 'today';
    }
    if (lowerBody === 'tomorrow' || lowerBody === 'yarın' || lowerBody === 'yarin' || lowerBody.startsWith('tomorrow ') || lowerBody.startsWith('yarın ') || lowerBody.startsWith('yarin ')) {
        return 'tomorrow';
    }
    if (lowerBody === 'week' || lowerBody === 'haftalık' || lowerBody === 'haftalik' || lowerBody === 'bu hafta' || lowerBody.startsWith('week ') || lowerBody.startsWith('haftalık ') || lowerBody.startsWith('haftalik ') || lowerBody.startsWith('bu hafta ')) {
        return 'week';
    }
    
    // Eski slash komutları da destekle (geriye dönük uyumluluk)
    if (trimmedBody.startsWith('/help') || trimmedBody.toLowerCase() === '/help') {
        return 'help';
    }
    if (trimmedBody.startsWith('/menu') || trimmedBody.toLowerCase() === '/menu') {
        return 'menu';
    }
    if (trimmedBody.startsWith('/today') || trimmedBody.toLowerCase() === '/today') {
        return 'today';
    }
    if (trimmedBody.startsWith('/tomorrow') || trimmedBody.toLowerCase() === '/tomorrow') {
        return 'tomorrow';
    }
    if (trimmedBody.startsWith('/week') || trimmedBody.toLowerCase() === '/week') {
        return 'week';
    }
    
    return null;
}

// Komut işleme
async function handleCommand(chat, message, command) {
    try {
        console.log(`📋 Komut alındı: ${command}`);
        
        const isPrivate = !(await message.getChat()).isGroup;
        
        switch (command) {
            case 'start':
                if (isPrivate) {
                    await sendPrivateHelpMessage(chat, message, true);
                } else {
                    await sendHelpMessage(chat, message);
                }
                break;
            case 'help':
                if (isPrivate) {
                    await sendPrivateHelpMessage(chat, message, false);
                } else {
                    await sendHelpMessage(chat, message);
                }
                break;
            case 'menu':
            case 'today':
                await sendYemekBilgisi(chat, message, null);
                break;
            case 'tomorrow':
                const tomorrow = new Date();
                tomorrow.setDate(tomorrow.getDate() + 1);
                const tomorrowStr = tomorrow.toISOString().split('T')[0];
                await sendYemekBilgisi(chat, message, tomorrowStr);
                break;
            case 'week':
                await sendWeeklyMenu(chat, message);
                break;
        }
    } catch (error) {
        console.error('❌ Komut işleme hatası:', error.message);
    }
}

// Yardım mesajı gönder
// Özel mesajlar için help mesajı
async function sendPrivateHelpMessage(chat, message, isStart = false) {
    const welcomeText = isStart ? `👋 *Hoş Geldiniz!*\n\n` : '';
    const helpText = `${welcomeText}📋 *KYK Yemek Botu - Özel Mesaj Komutları*

🔹 *Temel Komutlar:*
• \`start\` veya \`başla\` - Botu başlat ve yardım mesajını göster
• \`help\` veya \`yardım\` - Bu yardım mesajı
• \`menu\` veya \`menü\` - Bugünün yemek menüsü
• \`bugün\` - Bugünün yemek menüsü
• \`yarın\` - Yarının yemek menüsü
• \`haftalık\` veya \`week\` - Bu haftanın yemek menüsü

🔹 *Kullanım:*
• Özel mesajda direkt komut yazabilirsiniz
• Mention gerekmez, sadece komut yazın
• Örnek: \`menu\`, \`yarın\`, \`help\`

🔹 *Tarih Sorgulama:*
• "yarın", "pazartesi", "10 aralık" gibi ifadeler kullanabilirsiniz

🔹 *Örnekler:*
• \`start\` - Botu başlat
• \`menu\` - Bugünün menüsü
• \`yarın\` - Yarının menüsü
• \`haftalık\` - Haftalık menü

💡 *İpucu:* Herhangi bir mesaj yazarsanız otomatik olarak bu yardım mesajını göreceksiniz.

━━━━━━━━━━━━━━━━━━━━
@5428055983 (Tuna Karataş) tarafından geliştirilmiştir.`;

    try {
        await message.reply(helpText);
        rateLimiter.messageSent();
    } catch (error) {
        console.error('⚠️  Yardım mesajı gönderme hatası:', error.message);
    }
}

// Grup mesajları için help mesajı
async function sendHelpMessage(chat, message) {
    const helpText = `📋 *KYK Yemek Botu - Komutlar*

🔹 *Temel Komutlar:*
• \`help\` veya \`yardım\` - Bu yardım mesajı
• \`menu\` veya \`menü\` - Bugünün yemek menüsü
• \`bugün\` - Bugünün yemek menüsü
• \`yarın\` - Yarının yemek menüsü
• \`haftalık\` veya \`week\` - Bu haftanın yemek menüsü

🔹 *Kullanım:*
• Bot numarasını etiketleyin: \`@bot\`
• Komut yazın: \`@bot help\` veya \`@bot menu\`
• Veya sadece "yemek" yazın

🔹 *Tarih Sorgulama:*
• "yarın", "pazartesi", "10 aralık" gibi ifadeler kullanabilirsiniz

🔹 *Örnekler:*
• \`@bot help\` - Yardım mesajı
• \`@bot menu\` - Bugünün menüsü
• \`@bot yarın\` - Yarının menüsü
• \`@bot pazartesi\` - Pazartesi menüsü
• \`@bot 15 aralık\` - Belirli tarih menüsü
• \`@bot haftalık\` - Haftalık menü

━━━━━━━━━━━━━━━━━━━━
@5428055983 (Tuna Karataş) tarafından geliştirilmiştir.`;

    try {
        await message.reply(helpText);
        rateLimiter.messageSent();
    } catch (error) {
        console.error('⚠️  Yardım mesajı gönderme hatası:', error.message);
    }
}

// Haftalık menü gönder
async function sendWeeklyMenu(chat, message) {
    try {
        const today = new Date();
        const menus = [];
        
        // 7 günlük menüyü çek
        for (let i = 0; i < 7; i++) {
            const date = new Date(today);
            date.setDate(today.getDate() + i);
            const dateStr = date.toISOString().split('T')[0];
            
            try {
                const [kahvaltiResponse, aksamResponse] = await Promise.all([
                    axios.get(config.YEMEK_API_URL, {
                        params: { tarih: dateStr, sehir: 'balikesir', ogun: 'kahvalti' },
                        timeout: 5000
                    }).catch(() => null),
                    axios.get(config.YEMEK_API_URL, {
                        params: { tarih: dateStr, sehir: 'balikesir', ogun: 'aksam' },
                        timeout: 5000
                    }).catch(() => null)
                ]);
                
                if (kahvaltiResponse?.data || aksamResponse?.data) {
                    menus.push({
                        date: dateStr,
                        dateObj: date,
                        kahvalti: kahvaltiResponse?.data || null,
                        aksam: aksamResponse?.data || null
                    });
                }
            } catch (e) {
                // Hata durumunda devam et
            }
        }
        
        // Haftalık menü mesajını formatla
        let weeklyText = `📅 *Haftalık Yemek Menüsü*\n`;
        weeklyText += `━━━━━━━━━━━━━━━━━━━━\n\n`;
        
        if (menus.length === 0) {
            await message.reply('⚠️ Bu hafta için menü bulunamadı.');
            rateLimiter.messageSent();
            return;
        }
        
        menus.forEach((menu, index) => {
            const tarihObj = menu.dateObj;
            const gunler = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
            const aylar = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 
                          'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
            
            const gunAdi = gunler[tarihObj.getDay()];
            const gun = tarihObj.getDate();
            const ay = aylar[tarihObj.getMonth()];
            
            weeklyText += `📆 *${gunAdi}, ${gun} ${ay}*\n`;
            
            if (menu.kahvalti?.yemekler?.length > 0) {
                weeklyText += `🌤️ *Kahvaltı:* ${menu.kahvalti.yemekler.slice(0, 2).join(', ')}${menu.kahvalti.yemekler.length > 2 ? '...' : ''}\n`;
            }
            
            if (menu.aksam?.yemekler?.length > 0) {
                weeklyText += `🌙 *Akşam:* ${menu.aksam.yemekler.slice(0, 2).join(', ')}${menu.aksam.yemekler.length > 2 ? '...' : ''}\n`;
            }
            
            weeklyText += `\n`;
        });
        
        weeklyText += `━━━━━━━━━━━━━━━━━━━━\n`;
        weeklyText += `@5428055983 (Tuna Karataş) tarafından geliştirilmiştir.`;
        
        // Mesaj çok uzunsa böl
        if (weeklyText.length > 4000) {
            // İlk yarıyı gönder
            const firstHalf = weeklyText.substring(0, 2000);
            const lastNewline = firstHalf.lastIndexOf('\n');
            await message.reply(weeklyText.substring(0, lastNewline));
            rateLimiter.messageSent();
            
            // İkinci yarıyı gönder
            await rateLimiter.randomDelay();
            await message.reply(weeklyText.substring(lastNewline + 1));
            rateLimiter.messageSent();
        } else {
            await message.reply(weeklyText);
            rateLimiter.messageSent();
        }
        
    } catch (error) {
        console.error('❌ Haftalık menü gönderme hatası:', error.message);
        try {
            await message.reply('❌ Haftalık menü alınırken bir hata oluştu.');
            rateLimiter.messageSent();
        } catch (e) {
            // Sessizce geç
        }
    }
}

// Yemek bilgisini API'den çek ve gönder
async function sendYemekBilgisi(chat, message, requestedTarih = null) {
    try {
        // Rate limiting - mesaj göndermeden önce rastgele bekle
        await rateLimiter.randomDelay();

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
        
        // Mesajı gönder
        try {
            console.log(`   📤 Mesaj gönderiliyor... (Uzunluk: ${mesaj.length} karakter)`);
            console.log(`   📝 Mesaj önizleme: ${mesaj.substring(0, 100)}...`);
            
            // message.reply kullan (daha güvenilir)
            const sentMessage = await message.reply(mesaj);
            rateLimiter.messageSent(); // Mesaj sayacını güncelle
            
            console.log(`   ✅ Mesaj başarıyla gönderildi (ID: ${sentMessage.id._serialized || sentMessage.id || 'N/A'})`);
            console.log(`   📊 Günlük: ${rateLimiter.dailyMessageCount}/${ANTI_BAN_CONFIG.DAILY_MESSAGE_LIMIT}, Saatlik: ${rateLimiter.hourlyMessageCount}/${ANTI_BAN_CONFIG.HOURLY_MESSAGE_LIMIT}`);
        } catch (sendError) {
            console.error('⚠️  Mesaj gönderme hatası:', sendError.message);
            console.error('⚠️  Hata detayı:', sendError);
            console.error('⚠️  Hata stack:', sendError.stack);
            // Hata durumunda chat.sendMessage ile dene
            try {
                console.log(`   🔄 Alternatif yöntem deneniyor (chat.sendMessage)...`);
                const altSentMessage = await chat.sendMessage(mesaj);
                rateLimiter.messageSent();
                console.log(`   ✅ Alternatif yöntemle mesaj gönderildi (ID: ${altSentMessage.id._serialized || altSentMessage.id || 'N/A'})`);
            } catch (altError) {
                console.error('⚠️  Alternatif yöntem de başarısız:', altError.message);
                console.error('⚠️  Alternatif hata detayı:', altError);
                if (altError.message.includes('rate') || altError.message.includes('limit')) {
                    console.log('   ⚠️  Rate limit tespit edildi, mesaj gönderilmedi');
                }
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
    
    // Yardım mesajı ve geliştirici bilgisi
    mesaj += `\n\n━━━━━━━━━━━━━━━━━━━━\n`;
    mesaj += `💡 Yapabileceklerinizi öğrenmek için lütfen "@bot yardım" yazın\n\n`;
    mesaj += `━━━━━━━━━━━━━━━━━━━━\n`;
    mesaj += `@5428055983 (Tuna Karataş) tarafından geliştirilmiştir.`;
    
    return mesaj;
}

// Günlük bildirim sistemi
let notificationInterval = null;

function startDailyNotifications() {
    console.log('🔔 Günlük bildirim sistemi başlatılıyor...');
    console.log('   ⏰ Kahvaltı: Her gün 07:00');
    console.log('   ⏰ Akşam Yemeği: Her gün 16:00\n');
    
    // Her dakika kontrol et
    notificationInterval = setInterval(async () => {
        const now = new Date();
        const hour = now.getHours();
        const minute = now.getMinutes();
        
        // Saat 7:00 - Kahvaltı bildirimi
        if (hour === 7 && minute === 0) {
            console.log('🌤️  Kahvaltı bildirimi gönderiliyor...');
            await sendDailyNotification('kahvalti');
        }
        
        // Saat 16:00 - Akşam yemeği bildirimi
        if (hour === 16 && minute === 0) {
            console.log('🌙 Akşam yemeği bildirimi gönderiliyor...');
            await sendDailyNotification('aksam');
        }
    }, 60000); // Her dakika kontrol et
}

// Günlük bildirim gönder
async function sendDailyNotification(ogun) {
    try {
        const today = new Date();
        const dateStr = today.toISOString().split('T')[0];
        
        // Tüm grupları al
        const chats = await client.getChats();
        const groups = chats.filter(chat => chat.isGroup);
        
        console.log(`   📊 ${groups.length} grup bulundu`);
        
        // Her grup için bildirim gönder
        for (const group of groups) {
            try {
                // API'den yemek bilgisini çek
                let yemekBilgisi = null;
                try {
                    const response = await axios.get(config.YEMEK_API_URL, {
                        params: {
                            tarih: dateStr,
                            sehir: 'balikesir',
                            ogun: ogun
                        },
                        timeout: 10000
                    });
                    yemekBilgisi = response.data;
                } catch (e) {
                    console.log(`   ⚠️  ${group.name} için veri alınamadı`);
                    continue;
                }
                
                if (!yemekBilgisi || !yemekBilgisi.yemekler || yemekBilgisi.yemekler.length === 0) {
                    continue; // Veri yoksa geç
                }
                
                // Mesaj formatla
                const tarihObj = new Date(dateStr);
                const gunler = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
                const aylar = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 
                              'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
                
                const gunAdi = gunler[tarihObj.getDay()];
                const gun = tarihObj.getDate();
                const ay = aylar[tarihObj.getMonth()];
                
                let mesaj = '';
                if (ogun === 'kahvalti') {
                    mesaj = `🌤️ *${gunAdi}, ${gun} ${ay} - KAHVALTI MENÜSÜ*\n`;
                    mesaj += `━━━━━━━━━━━━━━━━━━━━\n\n`;
                    yemekBilgisi.yemekler.forEach((yemek, index) => {
                        mesaj += `${index + 1}. ${yemek}\n`;
                    });
                } else {
                    mesaj = `🌙 *${gunAdi}, ${gun} ${ay} - AKŞAM YEMEĞİ MENÜSÜ*\n`;
                    mesaj += `━━━━━━━━━━━━━━━━━━━━\n\n`;
                    yemekBilgisi.yemekler.forEach((yemek, index) => {
                        mesaj += `${index + 1}. ${yemek}\n`;
                    });
                }
                
                mesaj += `\n━━━━━━━━━━━━━━━━━━━━\n`;
                mesaj += `@5428055983 (Tuna Karataş) tarafından geliştirilmiştir.`;
                
                // Rate limiting
                await rateLimiter.randomDelay();
                
                // Mesajı gönder
                await group.sendMessage(mesaj);
                rateLimiter.messageSent();
                
                console.log(`   ✅ ${group.name} grubuna bildirim gönderildi`);
                
                // Gruplar arası bekleme (spam önleme)
                await new Promise(resolve => setTimeout(resolve, 2000));
                
            } catch (error) {
                console.error(`   ❌ ${group.name} grubuna bildirim gönderilemedi:`, error.message);
                // Hata olsa bile diğer gruplara devam et
            }
        }
        
        console.log('   ✅ Günlük bildirim tamamlandı\n');
        
    } catch (error) {
        console.error('❌ Günlük bildirim hatası:', error.message);
    }
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

