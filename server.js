const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.json({status: 'OK', service: 'EHunt Scraper'});
});

const DEFAULT_TOKEN = process.env.EHUNT_TOKEN;
const DEFAULT_USER_ID = process.env.EHUNT_USER_ID;

// Scrape endpoint
app.post('/scrape', async (req, res) => {
  try {
    const { url, token, user_id } = req.body;

      // Token yoksa default kullan
    const authToken = token || DEFAULT_TOKEN;
    const authUserId = user_id || DEFAULT_USER_ID;

    if (!url) {
      return res.status(400).json({error: 'URL required'});
    }

    console.log('Scraping:', url);

    const browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage'
      ]
    });

    const page = await browser.newPage();
    
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

    // Ana sayfaya git
    await page.goto('https://ehunt.ai', {waitUntil: 'domcontentloaded'});

    // Token'ları ekle (eğer gönderildiyse)
    if (token && user_id) {
      await page.evaluate((t, u) => {
        localStorage.setItem('token', t);
        localStorage.setItem('user_id', u);
        localStorage.setItem('plan', 'free');
        localStorage.setItem('ver', 'smb');
      }, token, user_id);
    }

    // Cookie'ler
    await page.setCookie(
      {name: 'sbox-l', value: 'en', domain: '.ehunt.ai'},
      {name: 'plan', value: 'free', domain: '.ehunt.ai'}
    );

    // Ürün sayfasına git
    await page.goto(url, {waitUntil: 'networkidle0', timeout: 45000});
    await page.waitForTimeout(5000);

    const html = await page.content();
    await browser.close();

    // Parse et
    const result = parseHTML(html, url);
    
    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// HTML Parse fonksiyonu
function parseHTML(html, sourceUrl) {
  function cleanText(text) {
    if (!text) return '';
    return text.trim().replace(/\s+/g, ' ');
  }

  function stripHtml(text) {
    if (!text) return '';
    return text.replace(/<[^>]*>/g, '').trim();
  }

  // Stats
  let sales = 0, favorites = 0, reviews = 0;
  
  const salesMatch = html.match(/(\d+)\s*Sales/i);
  if (salesMatch) sales = parseInt(salesMatch[1]);
  
  const favsMatch = html.match(/(\d+)\s*Favorites/i);
  if (favsMatch) favorites = parseInt(favsMatch[1]);
  
  const reviewsMatch = html.match(/(\d+)\s*Reviews/i);
  if (reviewsMatch) reviews = parseInt(reviewsMatch[1]);

  // Shop
  let shopName = '';
  const shopMatch = html.match(/Shop[:\s]+([A-Za-z0-9]+)/i);
  if (shopMatch) shopName = cleanText(shopMatch[1]);

  // Tags
  const tags = [];
  const tagRegex = /Tags[:\s]+([\s\S]{0,1000}?)(?:Shop|Store|<\/div>|$)/i;
  const tagSection = html.match(tagRegex);

  if (tagSection && tagSection[1]) {
    const lines = tagSection[1].split(/\n|<br>|,/);
    lines.forEach(line => {
      const cleaned = stripHtml(line).trim();
      if (cleaned && cleaned.length > 2 && cleaned.length < 50 && 
          !cleaned.includes('Login')) {
        tags.push(cleaned.toLowerCase());
      }
    });
  }

  const uniqueTags = [...new Set(tags)];

  // Product URL
  let productUrl = '';
  const urlMatch = html.match(/https:\/\/www\.etsy\.com\/listing\/\d+[^\s"<]*/);
  if (urlMatch) productUrl = urlMatch[0];

  return {
    stats: {
      sales,
      favorites,
      reviews,
      summary: `${sales} Sales | ${favorites} Favorites | ${reviews} Reviews`
    },
    tags: uniqueTags.slice(0, 20),
    shop: {
      name: shopName || 'Unknown',
      profile_url: shopName ? `https://ehunt.ai/store-detail/${shopName}` : ''
    },
    product_url: productUrl,
    ehunt_url: sourceUrl,
    scraped_at: new Date().toISOString()
  };
}

const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 dakika
  max: 10 // 10 istek/dakika
});

app.use('/scrape', limiter);

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 Scraper API running on port ${PORT}`);
});