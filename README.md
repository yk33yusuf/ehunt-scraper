# eHunt Scraper API

Railway üzerinde çalışan, headless browser ile eHunt.ai'den veri çeken API servisi.

## 🚀 Özellikler

- Playwright ile headless browser
- Otomatik login
- Product data scraping
- REST API endpoint

## 📦 Deployment (Railway)

1. GitHub'a push et
2. Railway'de "Deploy from GitHub" seç
3. Environment variables ekle:
   - `EHUNT_EMAIL`
   - `EHUNT_PASSWORD`
4. Deploy!

## 🔌 API Kullanımı

### Health Check
```bash
GET /health
```

### Scrape Product
```bash
POST /scrape
Content-Type: application/json

{
  "productId": "123"
}
```

### Response
```json
{
  "success": true,
  "data": {
    "title": "Product Title",
    "price": "$99",
    "description": "..."
  }
}
```

## 🛠️ Local Development
```bash
npm install
cp .env.example .env
# .env dosyasını düzenle
npm start
```

## 📝 n8n Entegrasyonu

HTTP Request node ile:
- Method: POST
- URL: `https://your-railway-url.up.railway.app/scrape`
- Body: `{"productId": "123"}`
```

---

## 📄 `.gitignore` dosyası (önemli!)
```
node_modules/
.env
*.log
.DS_Store
playwright/.cache/