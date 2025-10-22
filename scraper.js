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
    console.log('Email girildi:', process.env.EHUNT_EMAIL);

    await page.fill('input[name="LoginForm[password]"]', process.env.EHUNT_PASSWORD);
    console.log('Password girildi');

    // 3. Remember Me checkbox'ını işaretle (ID ile)
    await page.check('#loginform-rememberme');
    console.log('Remember Me işaretlendi');

    // 4. Kısa bir bekleme (form validation için)
    await page.waitForTimeout(1000);

    // 5. Login butonuna tıkla
    await page.click('#loginBut');
    console.log('Login butonuna tıklandı');

    // 6. Login sonrası bekle
    await page.waitForTimeout(3000);

    // URL kontrolü
    const currentUrl = page.url();
    console.log('Mevcut URL:', currentUrl);

    if (currentUrl.includes('/user/login')) {
      // Hata mesajı var mı kontrol et
      const errorMessage = await page.$eval('.help-block-error', el => el.innerText).catch(() => null);
      if (errorMessage) {
        throw new Error(`Login hatası: ${errorMessage}`);
      }
      throw new Error('Login başarısız! Hala login sayfasındayız.');
    }

    console.log('✅ Login başarılı!');

    // 7. Ürün sayfasına git
    await page.goto(`https://ehunt.ai/product-detail/${productId}`, {
      waitUntil: 'networkidle',
      timeout: 30000
    });
    console.log('Ürün sayfası yüklendi');

    // 8. Verileri çek
    const data = await page.evaluate(() => {
      return {
        title: document.querySelector('.product-title')?.innerText || 
               document.querySelector('h1')?.innerText || 
               document.querySelector('[class*="title"]')?.innerText ||
               null,
        price: document.querySelector('.price')?.innerText || 
               document.querySelector('[class*="price"]')?.innerText || 
               null,
        description: document.querySelector('.description')?.innerText || 
                    document.querySelector('[class*="description"]')?.innerText || 
                    null,
        pageTitle: document.title,
        currentUrl: window.location.href,
        bodyPreview: document.body.innerText.substring(0, 500)
      };
    });

    console.log('✅ Veri çekildi:', JSON.stringify(data, null, 2));
    return data;

  } catch (error) {
    console.error('❌ Hata:', error.message);
    console.error('Mevcut URL:', page.url());
    
    // Screenshot ve HTML
    try {
      await page.screenshot({ path: '/tmp/error-screenshot.png', fullPage: true });
      console.log('📸 Screenshot: /tmp/error-screenshot.png');
      
      const htmlContent = await page.content();
      console.log('📄 Sayfa HTML (ilk 2000 karakter):', htmlContent.substring(0, 2000));
    } catch {}

    throw new Error(`Scraping failed: ${error.message}`);
    
  } finally {
    await browser.close();
  }
}