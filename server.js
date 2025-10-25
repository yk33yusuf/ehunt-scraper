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

    // URL parse
    let productUrl = url.trim();
    if (/^\d+$/.test(productUrl)) {
      productUrl = `https://ehunt.ai/product-detail/${productUrl}`;
    }

    const authData = auth || DEFAULT_AUTH;

    console.log('==================');
    console.log('URL:', productUrl);
    console.log('Token:', authData.token ? `${authData.token.substring(0, 30)}...` : 'NONE');
    console.log('User ID:', authData.user_id);
    console.log('==================');

    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    const page = await browser.newPage();
    
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');

    // ===== YENİ YAKLAŞIM: DİREKT ÜRÜN SAYFASINA GİT =====
    console.log('[1/5] Going directly to product page...');
    
    // Önce cookie'leri set et (navigate etmeden)
    await page.setCookie(
      {name: 'sbox-l', value: 'en', domain: '.ehunt.ai', path: '/'},
      {name: 'plan', value: 'Free', domain: '.ehunt.ai', path: '/'},
      {name: 'local_username', value: authData.email, domain: '.ehunt.ai', path: '/'},
      {name: 'i18n_redirected', value: 'en', domain: '.ehunt.ai', path: '/'}
    );

    // Sayfaya git
    await page.goto(productUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    console.log('[2/5] Injecting token into main page...');
    
    // Ana sayfada localStorage'a ekle
    await page.evaluate((auth) => {
      localStorage.setItem('token', auth.token);
      localStorage.setItem('user_id', auth.user_id);
      localStorage.setItem('plan', auth.plan);
      localStorage.setItem('ver', auth.ver);
      localStorage.setItem('local_username', auth.email);
    }, authData);

    console.log('[3/5] Checking for iframe...');
    
    // İframe var mı kontrol et
    const iframeExists = await page.evaluate(() => {
      const iframe = document.querySelector('iframe');
      return iframe ? iframe.src : null;
    });

    console.log('Iframe found:', iframeExists);

    // Eğer iframe varsa, içine token inject et
    if (iframeExists) {
      console.log('[4/5] Injecting token into iframe...');
      
      await page.evaluate((auth) => {
        const iframe = document.querySelector('iframe');
        if (iframe && iframe.contentWindow) {
          try {
            iframe.contentWindow.localStorage.setItem('token', auth.token);
            iframe.contentWindow.localStorage.setItem('user_id', auth.user_id);
            iframe.contentWindow.localStorage.setItem('plan', auth.plan);
            iframe.contentWindow.localStorage.setItem('ver', auth.ver);
            console.log('✅ Token injected into iframe');
          } catch (e) {
            console.log('⚠️ Cannot access iframe localStorage:', e.message);
          }
        }
      }, authData);
    }

    // Sayfayı yenile (token'larla)
    console.log('[5/5] Reloading page with tokens...');
    await page.reload({ waitUntil: 'networkidle2', timeout: 45000 });

    // Ekstra bekle
    await page.waitForTimeout(8000);

    // Page state
    const pageCheck = await page.evaluate(() => {
      // İframe içindeki elementi kontrol et
      let iframeHasProduct = false;
      const iframe = document.querySelector('iframe');
      
      if (iframe && iframe.contentDocument) {
        iframeHasProduct = !!iframe.contentDocument.querySelector('[class*="listingDetail"]');
      }

      return {
        url: window.location.href,
        title: document.title,
        hasLoginButton: !!document.querySelector('a[href*="login"]'),
        hasUserProfile: !!document.querySelector('.nav-user-info'),
        hasProductInfo: !!document.querySelector('[class*="listingDetail"]'),
        hasTags: !!document.querySelector('[class*="listingDetailTags"]'),
        hasIframe: !!iframe,
        iframeHasProduct: iframeHasProduct,
        localStorageToken: !!localStorage.getItem('token'),
        bodyPreview: document.body.innerText.substring(0, 300)
      };
    });

    console.log('Page check:', JSON.stringify(pageCheck, null, 2));

    const html = await page.content();

    // Eğer iframe varsa, iframe içeriğini de al
    let iframeHtml = '';
    try {
      iframeHtml = await page.evaluate(() => {
        const iframe = document.querySelector('iframe');
        return iframe && iframe.contentDocument ? iframe.contentDocument.body.innerHTML : '';
      });
      
      if (iframeHtml) {
        console.log('✅ Iframe HTML extracted, length:', iframeHtml.length);
      }
    } catch (e) {
      console.log('⚠️ Could not extract iframe HTML:', e.message);
    }

    const screenshot = await page.screenshot({ encoding: 'base64', fullPage: false });

    await browser.close();

    // Parse - iframe HTML varsa onu kullan
    const htmlToParse = iframeHtml || html;
    const result = parseHTML(htmlToParse, productUrl);
    
    result.auth_status = {
      has_token: !!authData.token,
      email: authData.email,
      page_check: pageCheck,
      used_iframe_content: !!iframeHtml
    };
    
    result.debug.screenshot_base64 = screenshot;
    result.debug.html_source = iframeHtml ? 'iframe' : 'main';

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack
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
