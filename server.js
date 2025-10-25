const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
app.use(express.json());

// Environment'tan token'ları al (opsiyonel)
const DEFAULT_AUTH = {
  token: process.env.EHUNT_TOKEN || '',
  user_id: process.env.EHUNT_USER_ID || '',
  plan: process.env.EHUNT_PLAN || 'free',
  ver: process.env.EHUNT_VER || 'smb',
  email: process.env.EHUNT_EMAIL || ''
};

app.get('/', (req, res) => {
  res.json({
    status: 'OK',
    service: 'EHunt Scraper',
    hasDefaultAuth: !!DEFAULT_AUTH.token
  });
});

app.post('/scrape', async (req, res) => {
  try {
    const { url, auth } = req.body;

    if (!url) {
      return res.status(400).json({error: 'URL required'});
    }

    // Parse URL
    let productUrl = url;
    if (url.match(/^\d+$/)) {
      productUrl = `https://ehunt.ai/product-detail/${url}`;
    } else if (!url.startsWith('http')) {
      const match = url.match(/(\d+)/);
      if (match) {
        productUrl = `https://ehunt.ai/product-detail/${match[1]}`;
      }
    }

    // Token'ları belirle (request > default)
    const authData = auth || DEFAULT_AUTH;

    console.log('Scraping:', productUrl);
    console.log('Auth:', authData.email ? `User: ${authData.email}` : 'No auth');

    const browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    });

    const page = await browser.newPage();
    
    // User agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');

    // 1. Ana sayfaya git
    console.log('Loading base page...');
    await page.goto('https://ehunt.ai', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    // 2. localStorage'a token'ları ekle
    if (authData.token) {
      console.log('Injecting auth tokens...');
      await page.evaluate((auth) => {
        localStorage.setItem('token', auth.token);
        localStorage.setItem('user_id', auth.user_id);
        localStorage.setItem('plan', auth.plan);
        localStorage.setItem('ver', auth.ver);
        if (auth.email) {
          localStorage.setItem('local_username', auth.email);
        }
      }, authData);
    }

    // 3. Cookie'leri ekle
    await page.setCookie(
      {name: 'sbox-l', value: 'en', domain: '.ehunt.ai', path: '/'},
      {name: 'plan', value: authData.plan || 'free', domain: '.ehunt.ai', path: '/'},
      {name: 'i18n_redirected', value: 'en', domain: '.ehunt.ai', path: '/'}
    );

    if (authData.email) {
      await page.setCookie({
        name: 'local_username',
        value: authData.email,
        domain: '.ehunt.ai',
        path: '/'
      });
    }

    // 4. Ürün sayfasına git
    console.log('Loading product page...');
    await page.goto(productUrl, {
      waitUntil: 'networkidle0',
      timeout: 45000
    });

    // 5. İçerik yüklensin
    console.log('Waiting for content...');
    await page.waitForTimeout(5000);

    // 6. "Login to view" var mı kontrol et
    const html = await page.content();
    const hasLoginWall = html.includes('Login to view') || html.includes('login to view');

    if (hasLoginWall && authData.token) {
      console.warn('⚠️ Login wall detected despite token - token may be expired');
    }

    await browser.close();

    // Parse
    const result = parseHTML(html, productUrl);
    result.auth_status = {
      has_token: !!authData.token,
      login_wall_detected: hasLoginWall,
      email: authData.email || 'anonymous'
    };

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

function parseHTML(html, sourceUrl) {
  function cleanText(text) {
    if (!text) return '';
    return text.trim().replace(/\s+/g, ' ').replace(/&nbsp;/g, ' ');
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
  const shopMatch = html.match(/<a[^>]*href="[^"]*\/store-detail\/([^"]+)"[^>]*>([^<]+)<\/a>/i);
  if (shopMatch && shopMatch[2]) {
    shopName = cleanText(shopMatch[2]);
  }
  
  if (!shopName) {
    const directMatch = html.match(/Shop[:\s]+([A-Za-z0-9]+)/i);
    if (directMatch) shopName = cleanText(directMatch[1]);
  }

  // Tags
  const tags = [];
  const tagRegex = /Tags[:\s]+([\s\S]{0,1000}?)(?:Shop Info|Store|<\/div>|$)/i;
  const tagSection = html.match(tagRegex);

  if (tagSection && tagSection[1]) {
    const tagText = tagSection[1];
    const lines = tagText.split(/\n|<br>|,/);
    
    lines.forEach(line => {
      const cleaned = stripHtml(line).trim();
      if (cleaned && 
          cleaned.length > 2 && 
          cleaned.length < 50 &&
          !cleaned.toLowerCase().includes('login') && 
          !cleaned.toLowerCase().includes('view') &&
          !cleaned.match(/^\d+$/)) {
        tags.push(cleaned.toLowerCase());
      }
    });
  }

  const uniqueTags = [...new Set(tags)];

  // Tag wall check
  const hasTagLoginWall = html.includes('Login to view more information') || 
                          html.includes('login to view') ||
                          (uniqueTags.length === 0 && html.includes('Tags'));

  if (hasTagLoginWall && uniqueTags.length === 0) {
    uniqueTags.push('🔒 Login required to view tags');
  }

  // Product URL
  let productUrl = '';
  const urlMatch = html.match(/https:\/\/www\.etsy\.com\/listing\/\d+[^\s"<]*/);
  if (urlMatch) productUrl = urlMatch[0];

  // Price
  let price = '';
  const priceMatch = html.match(/\$(\d+\.?\d*)/);
  if (priceMatch) price = priceMatch[0];

  return {
    stats: {
      sales,
      favorites,
      reviews,
      summary: `${sales} Sales | ${favorites} Favorites | ${reviews} Reviews`
    },
    tags: uniqueTags.slice(0, 30),
    shop: {
      name: shopName || 'Unknown',
      profile_url: shopName ? `https://ehunt.ai/store-detail/${shopName}` : ''
    },
    product_url: productUrl,
    price: price,
    ehunt_url: sourceUrl,
    scraped_at: new Date().toISOString(),
    debug: {
      html_length: html.length,
      has_tag_wall: hasTagLoginWall,
      tags_found: uniqueTags.length
    }
  };
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 EHunt Scraper API on port ${PORT}`);
  console.log(`📌 Auth: ${DEFAULT_AUTH.token ? '✅ Token configured' : '⚠️ No default token'}`);
});
