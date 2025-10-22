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

    await page.waitForTimeout(5000); // Daha uzun bekle

    // 4. Login sonrası URL ve sayfa içeriği
    const loginResultUrl = page.url();
    console.log('📍 Login sonrası URL:', loginResultUrl);
    
    const loginBodyText = await page.evaluate(() => document.body.innerText);
    console.log('📝 Login sonrası body text (ilk 500 karakter):', loginBodyText.substring(0, 500));

    if (loginResultUrl.includes('/user/login')) {
      // Hata mesajı var mı?
      const errorMsg = await page.evaluate(() => {
        const errorEl = document.querySelector('.help-block-error');
        return errorEl ? errorEl.innerText : null;
      });
      throw new Error(`Login başarısız! Hata: ${errorMsg || 'Bilinmeyen'}`);
    }

    console.log('✅ Login başarılı!');

    // 5. Ürün sayfasına git
    await page.goto(`https://ehunt.ai/product-detail/${productId}`, {
      waitUntil: 'networkidle',
      timeout: 30000
    });
    console.log('✅ Ürün sayfasına yönlendirme yapıldı');

    // Çok uzun bekle (JavaScript için)
    await page.waitForTimeout(8000);

    // 6. Sayfa durumu
    const productUrl = page.url();
    console.log('📍 Ürün sayfası URL:', productUrl);

    // Body text'i al
    const bodyText = await page.evaluate(() => document.body.innerText);
    console.log('📝 Ürün sayfası body text (ilk 1000 karakter):', bodyText.substring(0, 1000));

    // HTML'in bir kısmını al
    const htmlSnippet = await page.evaluate(() => {
      const body = document.body.innerHTML;
      return body.substring(0, 2000);
    });
    console.log('📄 HTML snippet:', htmlSnippet);

    // "Upgrade" mesajı var mı kontrol et
    const hasUpgradeMessage = bodyText.includes('Upgrade') || bodyText.includes('upgrade');
    const hasPriceText = bodyText.includes('Price:');
    
    console.log('🔍 Sayfa analizi:', {
      hasUpgradeMessage,
      hasPriceText,
      bodyLength: bodyText.length
    });

    // 7. Verileri çek
    const data = await page.evaluate(() => {
      // Tüm div'leri kontrol et
      const allDivs = document.querySelectorAll('div[data-v-0dd74c48]');
      console.log('Toplam data-v div sayısı:', allDivs.length);

      // Price bilgisi içeren herhangi bir element
      const priceElements = Array.from(document.querySelectorAll('*'))
        .filter(el => el.innerText && el.innerText.includes('Price:'));
      
      console.log('Price içeren element sayısı:', priceElements.length);

      let currentPrice = null;
      let originalPrice = null;
      
      // Eğer Price: bulunduysa, yanındaki span'ları al
      if (priceElements.length > 0) {
        const priceParent = priceElements[0].parentElement;
        const spans = priceParent?.querySelectorAll('span') || [];
        
        for (let span of spans) {
          const text = span.innerText.trim();
          const style = span.getAttribute('style') || '';
          
          if (style.includes('font-size: 34px')) {
            currentPrice = text;
          } else if (style.includes('line-through')) {
            originalPrice = text;
          }
        }
      }

      return {
        productId: window.location.pathname.split('/').pop(),
        title: document.title,
        currentPrice: currentPrice,
        originalPrice: originalPrice,
        url: window.location.href,
        scrapedAt: new Date().toISOString(),
        debug: {
          totalDataVDivs: allDivs.length,
          priceElementsFound: priceElements.length,
          bodyTextLength: document.body.innerText.length
        }
      };
    });

    console.log('✅ Veri çekildi:', JSON.stringify(data, null, 2));
    return data;

  } catch (error) {
    console.error('❌ HATA:', error.message);
    console.error('Stack:', error.stack);
    
    try {
      await page.screenshot({ path: '/tmp/error-screenshot.png', fullPage: true });
      console.log('📸 Screenshot: /tmp/error-screenshot.png');
    } catch {}

    throw new Error(`Scraping failed: ${error.message}`);
    
  } finally {
    await browser.close();
  }
}