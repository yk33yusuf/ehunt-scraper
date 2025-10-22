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

    console.log('✅ Login başarılı! URL:', page.url());

    // 5. Ürün sayfasına git
    await page.goto(`https://ehunt.ai/product-detail/${productId}`, {
      waitUntil: 'networkidle',
      timeout: 30000
    });
    console.log('✅ Ürün sayfası yüklendi');

    // 6. "Price:" text'ini bekle (daha güvenilir)
    try {
      await page.waitForFunction(() => {
        return document.body.innerText.includes('Price:');
      }, { timeout: 15000 });
      console.log('✅ Price bilgisi yüklendi');
    } catch {
      console.log('⚠️ Price bilgisi bulunamadı, devam ediyorum...');
    }

    // Ekstra bekleme (JavaScript render için)
    await page.waitForTimeout(5000);

    // 7. Verileri çek (daha esnek selector'lar)
    const data = await page.evaluate(() => {
      // data-v attribute'u ile div bul
      const priceDiv = document.querySelector('[data-v-0dd74c48][class*="listingDetailPrice"]');
      
      let currentPrice = null;
      let originalPrice = null;
      let discount = null;
      let sales = null;
      let favorites = null;
      let reviews = null;
      let stocks = null;
      
      if (priceDiv) {
        // Tüm span'ları tara
        const spans = priceDiv.querySelectorAll('span');
        
        for (let span of spans) {
          const text = span.innerText.trim();
          const style = span.getAttribute('style') || '';
          
          // Büyük font = current price
          if (style.includes('font-size: 34px') || style.includes('font-size:34px')) {
            currentPrice = text.replace(/\s+/g, ' ').trim();
          }
          // Line-through = original price
          else if (style.includes('line-through')) {
            originalPrice = text.trim();
          }
          // "off" içeren = discount
          else if (text.includes('off')) {
            discount = text.trim();
          }
          // Stats içeren span
          else if (text.includes('Sales') || text.includes('Favorites')) {
            const salesMatch = text.match(/(\d+)\s*Sales/);
            const favoritesMatch = text.match(/(\d+)\s*Favorites/);
            const reviewsMatch = text.match(/(\d+)\s*Reviews/);
            const stocksMatch = text.match(/([\d,]+)\s*Stocks/);
            
            if (salesMatch) sales = parseInt(salesMatch[1]);
            if (favoritesMatch) favorites = parseInt(favoritesMatch[1]);
            if (reviewsMatch) reviews = parseInt(reviewsMatch[1]);
            if (stocksMatch) stocks = parseInt(stocksMatch[1].replace(/,/g, ''));
          }
        }
      }

      // Tags - data-v attribute ile bul
      const tagsDiv = document.querySelector('[data-v-0dd74c48][class*="listingDetailTags"]');
      const tags = [];
      
      if (tagsDiv) {
        const tagDivs = tagsDiv.querySelectorAll('[class*="listingDetailTagsDiv"] div[style*="cursor"]');
        for (let tag of tagDivs) {
          const text = tag.innerText.trim();
          if (text.length > 0) {
            tags.push(text);
          }
        }
      }

      // Title
      const title = document.querySelector('h1')?.innerText || 
                    document.querySelector('meta[property="og:title"]')?.getAttribute('content') ||
                    document.title;

      // Debug info
      const debugInfo = {
        hasPriceDiv: !!priceDiv,
        hasTagsDiv: !!tagsDiv,
        bodyTextIncludes: {
          price: document.body.innerText.includes('Price:'),
          tags: document.body.innerText.includes('Tags')
        }
      };

      return {
        productId: window.location.pathname.split('/').pop(),
        title: title,
        currentPrice: currentPrice,
        originalPrice: originalPrice,
        discount: discount,
        sales: sales,
        favorites: favorites,
        reviews: reviews,
        stocks: stocks,
        tags: tags,
        url: window.location.href,
        scrapedAt: new Date().toISOString(),
        debug: debugInfo
      };
    });

    console.log('✅ Veri çekildi:', JSON.stringify(data, null, 2));
    return data;

  } catch (error) {
    console.error('❌ Hata:', error.message);
    console.error('Mevcut URL:', page.url());
    
    try {
      // Screenshot
      await page.screenshot({ path: '/tmp/error-screenshot.png', fullPage: true });
      console.log('📸 Screenshot kaydedildi');
      
      // HTML içeriğini logla (ilk 5000 karakter)
      const html = await page.content();
      console.log('📄 HTML (ilk 5000 karakter):', html.substring(0, 5000));
      
      // Body text
      const bodyText = await page.evaluate(() => document.body.innerText);
      console.log('📝 Body text (ilk 2000 karakter):', bodyText.substring(0, 2000));
      
    } catch (debugError) {
      console.error('Debug bilgisi alınamadı:', debugError.message);
    }

    throw new Error(`Scraping failed: ${error.message}`);
    
  } finally {
    await browser.close();
  }
}