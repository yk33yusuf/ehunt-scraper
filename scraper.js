import { chromium } from 'playwright';

export async function scrapeProduct(productId) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'] // Railway için gerekli
  });

  const page = await browser.newPage();

  try {
    // 1. Login sayfasına git
    await page.goto('https://ehunt.ai/login');
    
    // 2. Giriş yap
    await page.fill('input[name="email"]', process.env.EHUNT_EMAIL);
    await page.fill('input[name="password"]', process.env.EHUNT_PASSWORD);
    await page.click('button[type="submit"]');
    
    // Login tamamlanmasını bekle
    await page.waitForURL('**/dashboard', { timeout: 10000 });

    // 3. Ürün sayfasına git
    await page.goto(`https://ehunt.ai/product-detail/${productId}`);
    await page.waitForLoadState('networkidle');

    // 4. Verileri çek
    const data = await page.evaluate(() => {
      return {
        title: document.querySelector('.product-title')?.innerText,
        price: document.querySelector('.price')?.innerText,
        description: document.querySelector('.description')?.innerText,
        // İhtiyacın olan tüm veriler...
      };
    });

    return data;

  } finally {
    await browser.close();
  }
}