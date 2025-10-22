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

    console.log('✅ Login sayfası yüklendi');

    // 2. Login form'u doldur
    await page.fill('input[name="LoginForm[username]"]', process.env.EHUNT_EMAIL);
    await page.fill('input[name="LoginForm[password]"]', process.env.EHUNT_PASSWORD);
    await page.check('#loginform-rememberme');
    
    console.log('✅ Form dolduruldu');

    await page.waitForTimeout(1000);

    // 3. Login butonuna tıkla
    await page.click('#loginBut');
    console.log('✅ Login butonuna tıklandı');

    await page.waitForTimeout(4000); // Login için bekle

    // 4. URL kontrolü
    if (page.url().includes('/user/login')) {
      throw new Error('Login başarısız!');
    }

    console.log('✅ Login başarılı!');

    // 5. Ürün sayfasına git
    await page.goto(`https://ehunt.ai/product-detail/${productId}`, {
      waitUntil: 'networkidle',
      timeout: 30000
    });
    console.log('✅ Ürün sayfası yüklendi');

    // 6. Price element'inin yüklenmesini bekle
    await page.waitForSelector('.src-css-product-listingDetailPrice-2yMy', { 
      timeout: 15000 
    });
    console.log('✅ Price element bulundu');

    // Ekstra bekleme (JavaScript render için)
    await page.waitForTimeout(3000);

    // 7. Verileri çek
    const data = await page.evaluate(() => {
      // Price
      const priceDiv = document.querySelector('.src-css-product-listingDetailPrice-2yMy');
      
      // Tüm span'ları al
      const spans = priceDiv?.querySelectorAll('span') || [];
      let currentPrice = null;
      let originalPrice = null;
      let discount = null;
      
      // Span'ları tara
      for (let span of spans) {
        const text = span.innerText.trim();
        const style = span.getAttribute('style') || '';
        
        // Büyük font = current price
        if (style.includes('font-size: 34px')) {
          currentPrice = text;
        }
        // Line-through = original price
        else if (style.includes('line-through')) {
          originalPrice = text;
        }
        // "off" içeren = discount
        else if (text.includes('off')) {
          discount = text;
        }
      }
      
      // Stats
      const statsSpan = priceDiv?.querySelector('span[style*="position: absolute"]');
      const statsText = statsSpan?.innerText || '';
      
      const salesMatch = statsText.match(/(\d+)\s*Sales/);
      const favoritesMatch = statsText.match(/(\d+)\s*Favorites/);
      const reviewsMatch = statsText.match(/(\d+)\s*Reviews/);
      const stocksMatch = statsText.match(/([\d,]+)\s*Stocks/);

      // Tags
      const tagsDiv = document.querySelector('.src-css-product-listingDetailTags-1CRx');
      const tags = Array.from(tagsDiv?.querySelectorAll('.src-css-product-listingDetailTagsDiv-bnGT div[style*="cursor"]') || [])
        .map(tag => tag.innerText.trim())
        .filter(tag => tag.length > 0);

      // Title
      const title = document.querySelector('h1')?.innerText || 
                    document.querySelector('meta[property="og:title"]')?.getAttribute('content') ||
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
    console.error('Mevcut URL:', page.url());
    
    try {
      await page.screenshot({ path: '/tmp/error-screenshot.png', fullPage: true });
      console.log('📸 Screenshot kaydedildi');
      
      // Debug: HTML'i de logla
      const html = await page.content();
      console.log('📄 HTML uzunluğu:', html.length);
    } catch {}

    throw new Error(`Scraping failed: ${error.message}`);
    
  } finally {
    await browser.close();
  }
}