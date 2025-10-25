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

    // Token'ları belirle
    const authData = auth || DEFAULT_AUTH;

    console.log('==================');
    console.log('Scraping:', productUrl);
    console.log('Token present:', !!authData.token);
    console.log('Token length:', authData.token ? authData.token.length : 0);
    console.log('User:', authData.email);
    console.log('==================');

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
    
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');

    // 1. Ana sayfaya git
    console.log('Step 1: Loading base page...');
    await page.goto('https://ehunt.ai', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    // Sayfa yüklendi mi kontrol
    await page.waitForTimeout(2000);

    // 2. localStorage'a BÜTÜN verileri ekle
    if (authData.token) {
      console.log('Step 2: Injecting localStorage...');
      
      await page.evaluate((auth) => {
        // Token'ları ekle
        localStorage.setItem('token', auth.token);
        localStorage.setItem('user_id', auth.user_id);
        localStorage.setItem('plan', auth.plan || 'free');
        localStorage.setItem('ver', auth.ver || 'smb');
        
        // Ekstra veriler
        if (auth.email) {
          localStorage.setItem('local_username', auth.email);
        }
        if (auth.subscription) {
          localStorage.setItem('subscription', auth.subscription);
        }
        if (auth.vip_url) {
          localStorage.setItem('vip_url', auth.vip_url);
        }
      }, authData);

      // localStorage doğrula
      const localStorageCheck = await page.evaluate(() => {
        return {
          token: localStorage.getItem('token')?.substring(0, 30),
          user_id: localStorage.getItem('user_id'),
          plan: localStorage.getItem('plan')
        };
      });
      
      console.log('localStorage verified:', localStorageCheck);
    }

    // 3. Cookie'leri ekle
    console.log('Step 3: Setting cookies...');
    await page.setCookie(
      {name: 'sbox-l', value: 'en', domain: '.ehunt.ai', path: '/'},
      {name: 'plan', value: authData.plan || 'free', domain: '.ehunt.ai', path: '/'},
      {name: 'i18n_redirected', value: 'en', domain: '.ehunt.ai', path: '/'},
      {name: 'is_first_visit', value: 'false', domain: '.ehunt.ai', path: '/'}
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
    console.log('Step 4: Loading product page...');
    await page.goto(productUrl, {
      waitUntil: 'networkidle2', // networkidle0 yerine networkidle2
      timeout: 45000
    });

    // 5. DAHA UZUN BEKLE (JavaScript için)
    console.log('Step 5: Waiting for JavaScript...');
    await page.waitForTimeout(8000); // 5 saniye yerine 8 saniye

    // 6. Sayfada "Login" var mı kontrol et
    const pageContent = await page.evaluate(() => {
      return {
        hasLoginButton: !!document.querySelector('a[href*="login"]'),
        hasUserProfile: !!document.querySelector('.nav-user-info'),
        pageTitle: document.title,
        bodyText: document.body.innerText.substring(0, 500)
      };
    });

    console.log('Page check:', pageContent);

    // 7. HTML'i al
    const html = await page.content();

    // 8. Screenshot al (debug için)
    const screenshot = await page.screenshot({ 
      encoding: 'base64',
      fullPage: false 
    });

    await browser.close();

    // Parse
    const result = parseHTML(html, productUrl);
    result.auth_status = {
      has_token: !!authData.token,
      token_length: authData.token ? authData.token.length : 0,
      login_wall_detected: html.includes('Login to view') || html.includes('login to view'),
      email: authData.email || 'anonymous',
      page_check: pageContent
    };
    
    // Debug için screenshot
    result.debug.screenshot_base64 = screenshot;

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
