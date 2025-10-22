import { chromium } from 'playwright';

export async function scrapeProduct(productId) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  try {
    // 1. Login sayfasına git
    await page.goto('https://ehunt.ai/user/login', { 
      waitUntil: 'networkidle',
      timeout: 30000 
    });

    console.log('Login sayfası yüklendi');

    // 2. Login form'u doldur
    await page.fill('input[name="LoginForm[username]"]', process.env.EHUNT_EMAIL);
    console.log('Email girildi');

    await page.fill('input[name="LoginForm[password]"]', process.env.EHUNT_PASSWORD);
    console.log('Password girildi');

    // 3. Remember Me checkbox
    await page.check('#loginform-rememberme');
    console.log('Remember Me işaretlendi');

    await page.waitForTimeout(1000);

    // 4. Login butonuna tıkla
    await page.click('#loginBut');
    console.log('Login butonuna tıklandı');

    await page.waitForTimeout(3000);

    // 5. URL kontrolü
    const currentUrl = page.url();
    console.log('Mevcut URL:', currentUrl);

    if (currentUrl.includes('/user/login')) {
      throw new Error('Login başarısız!');
    }

    console.log('✅ Login başarılı!');

    // 6. Ürün sayfasına git
    await page.goto(`https://ehunt.ai/product-detail/${productId}`, {
      waitUntil: 'networkidle',
      timeout: 30000
    });
    console.log('Ürün sayfası yüklendi');

    // Sayfa tam yüklenene kadar bekle
    await page.waitForTimeout(3000);

    // 7. Verileri çek
    const data = await page.evaluate(() => {
      // Price
      const priceDiv = document.querySelector('.src-css-product-listingDetailPrice-2yMy');
      const currentPrice = priceDiv?.querySelector('span[style*="font-size: 34px"]')?.innerText.trim() || null;
      const originalPrice = priceDiv?.querySelector('span[style*="line-through"]')?.innerText.trim() || null;
      const discount = priceDiv?.querySelector('span:nth-child(3)')?.innerText.trim() || null;
      
      // Stats (Sales, Favorites, Reviews, Stocks)
      const statsText = priceDiv?.querySelector('span[style*="position: absolute"]')?.innerText.trim() || '';
      const salesMatch = statsText.match(/(\d+)\s*Sales/);
      const favoritesMatch = statsText.match(/(\d+)\s*Favorites/);
      const reviewsMatch = statsText.match(/(\d+)\s*Reviews/);
      const stocksMatch = statsText.match(/([\d,]+)\s*Stocks/);

      // Tags
      const tagsDiv = document.querySelector('.src-css-product-listingDetailTags-1CRx');
      const tags = Array.from(tagsDiv?.querySelectorAll('.src-css-product-listingDetailTagsDiv-bnGT div') || [])
        .map(tag => tag.innerText.trim());

      // Title (h1 veya meta tag'den al)
      const title = document.querySelector('h1')?.innerText || 
                    document.querySelector('meta[property="og:title"]')?.content ||
                    document.title;

      return {
        productId: window.location.pathname.split('/').pop(),
        title: title,
        currentPrice: currentPrice,
        originalPrice: originalPrice,
        discount: discount,
        sales: salesMatch ? parseInt(salesMatch[1]) : null,
        favorites: favoritesMatch ? parseInt(favoritesMatch[1]) : null,
        reviews: reviewsMatch ? parseInt(reviewsMatch[1]) : null,
        stocks: stocksMatch ? parseInt(stocksMatch[1].replace(/,/g, '')) : null,
        tags: tags,
        url: window.location.href,
        scrapedAt: new Date().toISOString()
      };
    });

    console.log('✅ Veri çekildi:', JSON.stringify(data, null, 2));
    return data;

  } catch (error) {
    console.error('❌ Hata:', error.message);
    
    try {
      await page.screenshot({ path: '/tmp/error-screenshot.png', fullPage: true });
      console.log('📸 Screenshot: /tmp/error-screenshot.png');
    } catch {}

    throw new Error(`Scraping failed: ${error.message}`);
    
  } finally {
    await browser.close();
  }
}