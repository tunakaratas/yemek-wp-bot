# Yemek Listesi JSON Formatı

Yemek listesini JSON formatında oluşturmak için aşağıdaki formatı kullanın:

## Format

```json
{
  "YYYY-MM-DD": {
    "tarih": "YYYY-MM-DD",
    "kahvalti": [
      "Yemek 1",
      "Yemek 2",
      "Yemek 3"
    ],
    "aksam": [
      "Yemek 1",
      "Yemek 2",
      "Yemek 3",
      "Yemek 4",
      "Yemek 5"
    ]
  },
  "YYYY-MM-DD": {
    "tarih": "YYYY-MM-DD",
    "kahvalti": [...],
    "aksam": [...]
  }
}
```

## Örnek

```json
{
  "2025-12-08": {
    "tarih": "2025-12-08",
    "kahvalti": [
      "Peynir",
      "Zeytin",
      "Reçel",
      "Bal",
      "Yumurta",
      "Domates",
      "Salatalık",
      "Çay"
    ],
    "aksam": [
      "Mercimek Çorbası",
      "Izgara Tavuk",
      "Pilav",
      "Mevsim Salatası",
      "Sütlaç"
    ]
  },
  "2025-12-09": {
    "tarih": "2025-12-09",
    "kahvalti": [
      "Peynir",
      "Zeytin",
      "Reçel",
      "Bal",
      "Yumurta",
      "Domates",
      "Salatalık",
      "Çay"
    ],
    "aksam": [
      "Yayla Çorbası",
      "Köfte",
      "Makarna",
      "Çoban Salatası",
      "Baklava"
    ]
  }
}
```

## Notlar

- Tarih formatı: `YYYY-MM-DD` (örnek: `2025-12-08`)
- Her tarih için `kahvalti` ve `aksam` array'leri olmalı
- Yemek isimleri string array olarak yazılmalı
- Dosya adı: `balikesir-yemek-listesi.json`
- Dosya `yemek_wp` klasörüne kaydedilmeli

## Kullanım

1. Yemek listesini bu formatta hazırlayın
2. `balikesir-yemek-listesi.json` dosyasına kaydedin
3. API otomatik olarak bu dosyayı okuyacak
4. Bot bu dosyadan yemek listesini çekecek

