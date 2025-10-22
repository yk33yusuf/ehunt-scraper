import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';

chromium.use(stealth());

export async function scrapeProduct(productId) {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process'
    ]
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'en-US',
    timezoneId: 'America/New_York',
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
    }
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined
    });

    window.chrome = {
      runtime: {}
    };

    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) => (
      parameters.name === 'notifications' ?
        Promise.resolve({ state: Notification.permission }) :
        originalQuery(parameters)
    );

    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5]
    });

    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en']
    });
  });

  const page = await context.newPage();

  try {
    // 1. Login
    await page.goto('https://ehunt.ai/user/login', { 
      waitUntil: 'networkidle',
      timeout: 30000 
    });

    console.log('✅ Login page');

    await page.fill('input[name="LoginForm[username]"]', process.env.EHUNT_EMAIL);
    await page.fill('input[name="LoginForm[password]"]', process.env.EHUNT_PASSWORD);
    await page.check('#loginform-rememberme');
    
    await page.waitForTimeout(2000);

    await page.click('#loginBut');
    console.log('✅ Login clicked');

    await page.waitForTimeout(6000);

    if (page.url().includes('/user/login')) {
      throw new Error('Login failed');
    }

    console.log('✅ Login success');

    // 2. Product page
    await page.goto(`https://ehunt.ai/product-detail/${productId}`, {
      waitUntil: 'networkidle',
      timeout: 30000
    });
    
    console.log('✅ Product page loaded');

    await page.waitForTimeout(12000);

    // 3. TÜM HTML'İ DÖNDÜR
    const pageData = await page.evaluate(() => {
      return {
        fullHTML: document.documentElement.outerHTML,
        bodyHTML: document.body.innerHTML,
        bodyText: document.body.innerText,
        url: window.location.href,
        title: document.title
      };
    });

    console.log('✅ HTML collected');
    console.log('📊 HTML length:', pageData.fullHTML.length);
    console.log('📊 Body HTML length:', pageData.bodyHTML.length);
    console.log('📊 Body text length:', pageData.bodyText.length);

    return {
      productId: productId,
      url: pageData.url,
      title: pageData.title,
      fullHTML: pageData.fullHTML,
      bodyHTML: pageData.bodyHTML,
      bodyText: pageData.bodyText,
      scrapedAt: new Date().toISOString()
    };

  } catch (error) {
    console.error('❌ Error:', error.message);
    throw error;
  } finally {
    await browser.close();
  }
}