import express from 'express';
import { scrapeProduct } from './scraper.js';

const app = express();
app.use(express.json());

app.post('/scrape', async (req, res) => {
  try {
    const { productId } = req.body;
    
    if (!productId) {
      return res.status(400).json({ error: 'productId gerekli' });
    }

    const data = await scrapeProduct(productId);
    res.json({ success: true, data });
    
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});