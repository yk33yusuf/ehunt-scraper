const express = require('express');
const { chromium } = require('playwright');
const cheerio = require('cheerio');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;

app.post('/scrape', async (req, res) => {
  let browser;
  
  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'URL required' });
    }

    // Product ID çıkar
    let productId = url.trim();
    if (productId.includes('product-detail/')) {
      const match = productId.match(/product-detail\/(\d+)/);
      productId = match ? match[1] : productId;
    }

    console.log('Scraping product:', productId);

    // Browser başlat
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    });

    const page = await context.newPage();

    // Direkt ürün sayfasına git
    const targetUrl = `https://ehunt.ai/product-detail/${productId}`;
    console.log('Loading:', targetUrl);

    await page.goto(targetUrl, { 
      waitUntil: 'networkidle',
      timeout: 60000 
    });

    // Bekle
    await page.waitForTimeout(5000);

    // HTML al
    const html = await page.content();
    
    // Screenshot al
    const screenshot = await page.screenshot({ 
      fullPage: false,
      type: 'png'
    });

    // Parse
    const $ = cheerio.load(html);
    const bodyText = $('body').text();

    const result = {
      productId,
      url: targetUrl,
      title: $('title').text() || 'No title',
      bodyTextPreview: bodyText.substring(0, 500),
      htmlLength: html.length,
      hasLoginWall: bodyText.includes('Login') || bodyText.includes('Sign in'),
      screenshot: screenshot.toString('base64')
    };

    console.log('Success:', result.title);

    await browser.close();

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    if (browser) await browser.close();
    
    console.error('Error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});