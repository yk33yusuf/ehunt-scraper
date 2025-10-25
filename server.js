const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
app.use(express.json());

// Environment'tan token'ları al (opsiyonel)
const DEFAULT_AUTH = {
  token: process.env.EHUNT_TOKEN || '',
  user_id: process.env.EHUNT_USER_ID || '',
  plan: process.env.EHUNT_PLAN || 'Free',
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

    let productId = url.trim();
    
    if (/^\d+$/.test(productId)) {
      // Sadece ID
    } else if (productId.includes('product-detail/')) {
      const match = productId.match(/product-detail\/(\d+)/);
      productId = match ? match[1] : productId;
    } else {
      return res.status(400).json({error: 'Invalid URL or product ID'});
    }

    const authData = auth || DEFAULT_AUTH;

    console.log('==================');
    console.log('Product ID:', productId);
    console.log('==================');

    const browser = await puppeteer.launch({
      headless: false, // ← Görünür mod (test için)
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox', 
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled'
      ]
    });

    const page = await browser.newPage();
    
    // Anti-detection
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
      });
    });
    
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');

    // ===== DİREKT ÜRÜN SAYFASINA GİT =====
    console.log('[1/3] Going directly to product page...');
    
    const targetUrl = `https://ehunt.ai/product-detail/${productId}`;
    
    await page.goto(targetUrl, {
      waitUntil: 'networkidle0',
      timeout: 60000
    });

    console.log('[2/3] Waiting for page to fully load...');
    
    // Daha uzun bekle
    await page.waitForTimeout(15000);

    // Scroll yap (lazy loading için)
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight / 2);
    });

    await page.waitForTimeout(3000);

    console.log('[3/3] Extracting data...');

    // Sayfadaki tüm text'i al
    const pageContent = await page.evaluate(() => {
      return {
        title: document.title,
        bodyText: document.body.innerText,
        // Belirli elementleri ara
        sales: document.body.innerText.match(/(\d+)\s*Sales/i)?.[1] || '0',
        favorites: document.body.innerText.match(/(\d+)\s*Favorites/i)?.[1] || '0',
        reviews: document.body.innerText.match(/(\d+)\s*Reviews/i)?.[1] || '0',
        shopName: document.querySelector('[class*="shop"]')?.innerText || 'Unknown',
        price: document.querySelector('[class*="price"]')?.innerText || 'Unknown',
        // Login wall kontrolü
        hasLoginWall: document.body.innerText.includes('Login') || 
                      document.body.innerText.includes('Sign in') ||
                      document.body.innerText.includes('登录'),
        // Tüm görünür text
        allText: document.body.innerText.substring(0, 2000)
      };
    });

    console.log('Page content:', JSON.stringify(pageContent, null, 2));

    const html = await page.content();
    const screenshot = await page.screenshot({ 
      encoding: 'base64',
      fullPage: true 
    });

    // 10 saniye bekle (manuel kontrol için)
    console.log('⏳ Waiting 10 seconds for manual check...');
    await page.waitForTimeout(10000);

    await browser.close();

    const result = {
      productId,
      url: targetUrl,
      pageContent,
      html_length: html.length,
      screenshot_base64: screenshot
    };

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
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

  // ===== STATS =====
  let sales = 0, favorites = 0, reviews = 0;
  
  const salesMatch = html.match(/(\d+)\s*Sales/i);
  if (salesMatch) sales = parseInt(salesMatch[1]);
  
  const favsMatch = html.match(/(\d+)\s*Favorites/i);
  if (favsMatch) favorites = parseInt(favsMatch[1]);
  
  const reviewsMatch = html.match(/(\d+)\s*Reviews/i);
  if (reviewsMatch) reviews = parseInt(reviewsMatch[1]);

  // ===== SHOP NAME =====
  let shopName = '';
  const shopMatch = html.match(/<a[^>]*href="[^"]*\/store-detail\/([^"]+)"[^>]*>([^<]+)<\/a>/i);
  if (shopMatch && shopMatch[2]) {
    shopName = cleanText(shopMatch[2]);
  }
  
  if (!shopName) {
    const directMatch = html.match(/Shop[:\s]+([A-Za-z0-9]+)/i);
    if (directMatch) shopName = cleanText(directMatch[1]);
  }

  // ===== TAGS - YENİ YÖNTEM =====
  const tags = [];
  
  // Önce tag section'ı bul
  const tagSectionMatch = html.match(/<div[^>]*class="[^"]*listingDetailTags[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i);
  
  if (tagSectionMatch && tagSectionMatch[1]) {
    const tagSection = tagSectionMatch[1];
    
    // Tüm tag div'lerini bul
    const tagDivRegex = /<div[^>]*class="[^"]*listingDetailTagsDiv[^"]*"[^>]*>[\s\S]*?<div[^>]*>(.*?)<\/div>[\s\S]*?<\/div>/gi;
    let match;
    
    while ((match = tagDivRegex.exec(tagSection)) !== null) {
      const tag = stripHtml(match[1]).trim();
      if (tag && tag.length > 0) {
        tags.push(tag.toLowerCase());
      }
    }
  }

  // Alternatif: Daha basit regex (fallback)
  if (tags.length === 0) {
    const simpleTagRegex = /<div[^>]*style="cursor: pointer[^"]*"[^>]*>([^<]+)<\/div>/gi;
    const tagSection = html.match(/Tags[:\s]+([\s\S]{0,3000}?)(?:Shop Info|Store|Price History)/i);
    
    if (tagSection && tagSection[1]) {
      let match;
      while ((match = simpleTagRegex.exec(tagSection[1])) !== null) {
        const tag = stripHtml(match[1]).trim();
        if (tag && 
            tag.length > 2 && 
            tag.length < 100 &&
            !tag.toLowerCase().includes('login')) {
          tags.push(tag.toLowerCase());
        }
      }
    }
  }

  // Duplicate temizle
  const uniqueTags = [...new Set(tags)];

  // Tag wall check
  const hasTagLoginWall = html.includes('Login to view more information') || 
                          html.includes('login to view');

  if (uniqueTags.length === 0 && hasTagLoginWall) {
    uniqueTags.push('🔒 Login required to view tags');
  } else if (uniqueTags.length === 0) {
    uniqueTags.push('⚠️ No tags found in HTML');
  }

  // ===== PRODUCT URL =====
  let productUrl = '';
  const urlMatch = html.match(/https:\/\/www\.etsy\.com\/listing\/\d+[^\s"<]*/);
  if (urlMatch) productUrl = urlMatch[0];

  // ===== PRICE =====
  let price = '';
  const priceMatch = html.match(/\$(\d+\.?\d*)/);
  if (priceMatch) price = priceMatch[0];

  // ===== TITLE =====
  let title = '';
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) {
    title = stripHtml(titleMatch[1]).replace(' - EtsyHunt', '').trim();
  }

  return {
    title: title,
    
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
      tags_found: uniqueTags.length,
      has_tag_section: !!tagSectionMatch
    }
  };
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 EHunt Scraper API on port ${PORT}`);
  console.log(`📌 Auth: ${DEFAULT_AUTH.token ? '✅ Token configured' : '⚠️ No default token'}`);
});
