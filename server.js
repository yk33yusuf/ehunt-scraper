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

    // URL'den product ID'yi çıkar
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
    console.log('Token present:', !!authData.token);
    console.log('==================');

    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    const page = await browser.newPage();
    
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');

    // ===== DİREKT İFRAME URL'İNE GİT =====
    const targetUrl = `https://ehunt.ai/iframe/product-detail/${productId}`;
    
    console.log('[1/4] Loading iframe URL:', targetUrl);
    
    await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    console.log('[2/4] Injecting tokens...');
    
    // Token'ları ve subscription'ı ekle
    await page.evaluate((auth) => {
      localStorage.setItem('token', auth.token);
      localStorage.setItem('user_id', auth.user_id);
      localStorage.setItem('plan', auth.plan);
      localStorage.setItem('ver', auth.ver);
      localStorage.setItem('local_username', auth.email);
      localStorage.setItem('lan', 'en');
      localStorage.setItem('local_userimg', '');
      localStorage.setItem('vip_url', 'undefined');
      
      // Subscription bilgisini ekle
      localStorage.setItem('subscription', JSON.stringify({
        "plan_id": 252,
        "code": "etsy_plan_0_month_0",
        "channel": 3,
        "period_start": "",
        "period_end": "",
        "price": 0,
        "plan_type": "Free",
        "default_plan": "etsy_plan_0_month_0",
        "is_admin": 0,
        "old_code": 0,
        "refund_tips": ""
      }));
    }, authData);

    // Cookie'ler
    await page.setCookie(
      {name: 'sbox-l', value: 'en', domain: '.ehunt.ai', path: '/'},
      {name: 'plan', value: authData.plan, domain: '.ehunt.ai', path: '/'},
      {name: 'local_username', value: authData.email, domain: '.ehunt.ai', path: '/'}
    );

    console.log('[3/4] Reloading with auth...');
    
    // Sayfayı yenile
    await page.reload({ waitUntil: 'networkidle2', timeout: 45000 });

    console.log('[4/4] Waiting for content...');
    
    // JavaScript yüklensin
    await page.waitForTimeout(8000);

    // Content check
    const pageCheck = await page.evaluate(() => ({
      url: window.location.href,
      title: document.title,
      hasProductInfo: !!document.querySelector('[class*="listingDetail"]'),
      hasTags: !!document.querySelector('[class*="listingDetailTags"]'),
      hasStats: document.body.innerText.includes('Sales'),
      hasLoginWall: document.body.innerText.includes('Login to view'),
      bodyLength: document.body.innerHTML.length,
      bodyPreview: document.body.innerText.substring(0, 500),
      // LocalStorage kontrolü ekle
      localStorage: {
        hasToken: !!localStorage.getItem('token'),
        hasSubscription: !!localStorage.getItem('subscription'),
        plan: localStorage.getItem('plan'),
        userId: localStorage.getItem('user_id')
      }
    }));

    console.log('Page check:', JSON.stringify(pageCheck, null, 2));

    const html = await page.content();
    console.log('HTML length:', html.length);

    const screenshot = await page.screenshot({ 
      encoding: 'base64',
      fullPage: false 
    });

    await browser.close();

    // Parse
    const result = parseHTML(html, `https://ehunt.ai/product-detail/${productId}`);
    
    result.auth_status = {
      has_token: !!authData.token,
      email: authData.email,
      page_check: pageCheck
    };
    
    
    result.debug.screenshot_base64 = screenshot;

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
