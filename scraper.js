import { chromium } from 'playwright';

export async function scrapeProduct(productId) {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled', // Bot detection bypass
      '--disable-dev-shm-usage'
    ]
  });

  const context = await browser.newContext({
    // Gerçek browser gibi görün
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'en-US',
    timezoneId: 'America/New_York',
    // Extra headers
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
    }
  });

  // Navigator properties üzerine yaz (bot detection bypass)
  await context.addInitScript(() => {
    // Webdriver özelliğini gizle
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined
    });

    // Chrome özelliklerini ekle
    window.chrome = {
      runtime: {}
    };

    // Permissions API
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) => (
      parameters.name === 'notifications' ?
        Promise.resolve({ state: Notification.permission }) :
        originalQuery(parameters)
    );

    // Plugin array
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5]
    });

    // Language
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en']
    });
  });

  const page = await context.newPage();

  // Console ve network error'ları yakala
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('❌ Console error:', msg.text());
    }
  });

  try {
    // 1. Login sayfasına git
    await page.goto('https://ehunt.ai/user/login', { 
      waitUntil: 'networkidle',
      timeout: 30000 
    });

    console.log('✅ Login sayfası');

    // 2. Login form
    await page.fill('input[name="LoginForm[username]"]', process.env.EHUNT_EMAIL);
    await page.fill('input[name="LoginForm[password]"]', process.env.EHUNT_PASSWORD);
    await page.check('#loginform-rememberme');
    
    await page.waitForTimeout(2000);

    // 3. Login
    await page.click('#loginBut');
    console.log('✅ Login clicked');

    await page.waitForTimeout(6000);

    if (page.url().includes('/user/login')) {
      throw new Error('Login failed');
    }

    console.log('✅ Login success');

    // 4. Ürün sayfası
    await page.goto(`https://ehunt.ai/product-detail/${productId}`, {
      waitUntil: 'networkidle',
      timeout: 30000
    });
    
    console.log('✅ Product page loaded');

    // Uzun bekleme (render için)
    await page.waitForTimeout(12000);

    // 5. Sayfa analizi
    const bodyText = await page.evaluate(() => document.body.innerText);
    console.log('📝 Body length:', bodyText.length);
    console.log('📝 First 1000 chars:', bodyText.substring(0, 1000));

    // 6. Veri çek
    const data = await page.evaluate(() => {
      // Price div'i bul
      const allText = document.body.innerText;
      
      // Manuel regex parsing
      const priceMatch = allText.match(/Price:\s*\$\s*([\d.]+)/i);
      const salesMatch = allText.match(/(\d+)\s*Sales/i);
      const favoritesMatch = allText.match(/(\d+)\s*Favorites/i);
      const reviewsMatch = allText.match(/(\d+)\s*Reviews/i);
      const stocksMatch = allText.match(/([\d,]+)\s*Stocks/i);

      return {
        productId: window.location.pathname.split('/').pop(),
        title: document.title,
        currentPrice: priceMatch ? `$${priceMatch[1]}` : null,
        sales: salesMatch ? parseInt(salesMatch[1]) : null,
        favorites: favoritesMatch ? parseInt(favoritesMatch[1]) : null,
        reviews: reviewsMatch ? parseInt(reviewsMatch[1]) : null,
        stocks: stocksMatch ? parseInt(stocksMatch[1].replace(/,/g, '')) : null,
        url: window.location.href,
        scrapedAt: new Date().toISOString(),
        bodyLength: allText.length
      };
    });

    console.log('✅ Data:', JSON.stringify(data, null, 2));
    return data;

  } catch (error) {
    console.error('❌ Error:', error.message);
    
    try {
      await page.screenshot({ path: '/tmp/error.png', fullPage: true });
    } catch {}

    throw error;
    
  } finally {
    await browser.close();
  }
}