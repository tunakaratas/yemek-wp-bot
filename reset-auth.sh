#!/bin/bash
# WhatsApp auth bilgilerini sıfırla

echo "🔄 WhatsApp auth bilgileri sıfırlanıyor..."
rm -rf .wwebjs_auth
rm -rf .wwebjs_cache
echo "✅ Auth bilgileri silindi. Botu yeniden başlatın."
echo "💡 Komut: npm start"

