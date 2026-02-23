import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import { createApiRoutes } from "./src/routes/apiRoutes.js";
import { registerRoutes } from "./src/routes/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
registerRoutes(app);
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: '*',
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['*']
}));
app.use(express.json());

// ========================================
// SERVE STATIC FILES AND ROOT ROUTE
// ========================================
app.use(express.static(path.join(__dirname, 'public')));

// Root route - serve index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Helper functions
const jsonResponse = (res, data, status = 200) =>
  res.status(status).json({ success: true, results: data });

const jsonError = (res, message = "Internal server error", status = 500) =>
  res.status(status).json({ success: false, message });

// ========================================
// 🔥 ULTIMATE VIDEO PROXY - BYPASSES ALL CDN PROTECTIONS
// ========================================

// List of CDN domains that need special handling
const CDN_DOMAINS = [
  'fogtwist21.xyz',
  'rainveil36.xyz',
  'lightningspark77.pro',
  'dl.netmagcdn.com',
  'sunshinerays93.live',
  'rabbitstream.net',
  'dokicloud.one',
  'gogocdn.net',
  'goload.pro'
];

// Generate realistic browser headers
function getBrowserHeaders(url, referer) {
  const urlObj = new URL(url);
  const origin = `${urlObj.protocol}//${urlObj.host}`;
  
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Referer': referer || origin + '/',
    'Origin': origin,
    'DNT': '1',
    'Connection': 'keep-alive',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'cross-site',
    'Sec-Ch-Ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache'
  };
}

// OPTIONS handler for CORS preflight
app.options("/api/proxy-video", (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.status(204).send();
});

app.get("/api/proxy-video", async (req, res) => {
  try {
    const { url, headers: customHeaders } = req.query;
    
    if (!url) {
      return res.status(400).json({ error: 'URL parameter required' });
    }

    console.log('🎬 Proxying:', url);

    const urlObj = new URL(url);
    const baseUrl = `${urlObj.protocol}//${urlObj.host}`;
    const pathOnly = urlObj.pathname.substring(0, urlObj.pathname.lastIndexOf('/') + 1);
    const isPlaylist = url.includes('.m3u8');
    
    // Determine referer based on CDN
    let referer = baseUrl + '/';
    const hostname = urlObj.hostname.toLowerCase();
    
    if (hostname.includes('fogtwist') || hostname.includes('rainveil') || 
        hostname.includes('lightningspark') || hostname.includes('netmagcdn') || 
        hostname.includes('sunshinerays')) {
      // These CDNs need specific referer
      referer = baseUrl + '/';
    }

    // Make request with spoofed headers
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: isPlaylist ? 'text' : 'stream',
      headers: getBrowserHeaders(url, referer),
      timeout: 30000,
      maxRedirects: 5,
      validateStatus: (status) => status < 500,
      decompress: true,
      httpsAgent: new (await import('https')).Agent({
        rejectUnauthorized: false, // Ignore SSL errors
        keepAlive: true
      })
    });

    // Set permissive CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Expose-Headers', '*');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    
    if (isPlaylist) {
      console.log('✅ M3U8 Playlist detected, rewriting URLs...');
      
      let playlist = response.data;
      const lines = playlist.split('\n');
      const rewrittenLines = [];
      
      for (let line of lines) {
        // Keep comments and empty lines
        if (line.startsWith('#') || line.trim() === '') {
          rewrittenLines.push(line);
          continue;
        }
        
        let targetUrl = line.trim();
        
        // Skip empty lines
        if (!targetUrl) {
          rewrittenLines.push(line);
          continue;
        }
        
        // Convert relative URLs to absolute
        if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
          if (targetUrl.startsWith('/')) {
            targetUrl = baseUrl + targetUrl;
          } else {
            targetUrl = baseUrl + pathOnly + targetUrl;
          }
        }
        
        // Route through our proxy
        const proxiedUrl = `https://anime-api-1ci7.onrender.com/api/proxy-video?url=${encodeURIComponent(targetUrl)}`;
        rewrittenLines.push(proxiedUrl);
      }
      
      const rewrittenPlaylist = rewrittenLines.join('\n');
      
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.send(rewrittenPlaylist);
      
      console.log('✅ Playlist sent with', rewrittenLines.length, 'lines');
      
    } else {
      console.log('✅ Video segment detected, streaming...');
      
      // Stream video segments
      res.setHeader('Content-Type', response.headers['content-type'] || 'video/mp2t');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'public, max-age=31536000');
      
      if (response.headers['content-length']) {
        res.setHeader('Content-Length', response.headers['content-length']);
      }
      if (response.headers['content-range']) {
        res.setHeader('Content-Range', response.headers['content-range']);
      }
      
      // Pipe the video data
      response.data.pipe(res);
      
      response.data.on('error', (error) => {
        console.error('❌ Stream error:', error.message);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Stream failed' });
        }
      });
    }
    
  } catch (error) {
    console.error('❌ Proxy error:', error.message);
    
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    if (!res.headersSent) {
      res.status(error.response?.status || 500).json({ 
        error: 'Proxy request failed', 
        details: error.message,
        url: req.query.url
      });
    }
  }
});

// ========================================
// 🔥 PIXELDRAIN PROXY - BYPASS INDIA BLOCK
// ========================================

app.options("/api/proxy-pixeldrain", (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.status(204).send();
});

app.get("/api/proxy-pixeldrain", async (req, res) => {
  try {
    const { url } = req.query;
    
    if (!url) {
      return res.status(400).json({ error: 'URL parameter required' });
    }

    console.log('🎬 Proxying PixelDrain:', url);

    // Fetch from PixelDrain (your server bypasses the India block)
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
      },
      timeout: 30000,
      maxRedirects: 5,
    });

    // Set permissive CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Expose-Headers', '*');
    
    // Set video headers
    res.setHeader('Content-Type', response.headers['content-type'] || 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    
    if (response.headers['content-length']) {
      res.setHeader('Content-Length', response.headers['content-length']);
    }
    if (response.headers['content-range']) {
      res.setHeader('Content-Range', response.headers['content-range']);
    }

    // Stream the video data
    response.data.pipe(res);
    
    response.data.on('error', (error) => {
      console.error('❌ PixelDrain stream error:', error.message);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Stream failed' });
      }
    });
    
  } catch (error) {
    console.error('❌ PixelDrain proxy error:', error.message);
    
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    if (!res.headersSent) {
      res.status(error.response?.status || 500).json({ 
        error: 'Proxy request failed', 
        details: error.message,
        url: req.query.url
      });
    }
  }
});

// ========================================
// 🔥 ALTERNATIVE PROXY WITH RATE LIMIT BYPASS
// ========================================

app.get("/api/proxy-stream", async (req, res) => {
  try {
    const { url } = req.query;
    
    if (!url) {
      return res.status(400).json({ error: 'URL required' });
    }

    // Use multiple user agents randomly to avoid rate limiting
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0'
    ];
    
    const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];
    const urlObj = new URL(url);
    
    const response = await axios.get(url, {
      responseType: 'stream',
      headers: {
        'User-Agent': randomUA,
        'Referer': `${urlObj.protocol}//${urlObj.host}/`,
        'Origin': `${urlObj.protocol}//${urlObj.host}`,
        'Accept': '*/*'
      },
      timeout: 30000
    });

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', response.headers['content-type'] || 'application/octet-stream');
    
    if (response.headers['content-length']) {
      res.setHeader('Content-Length', response.headers['content-length']);
    }
    
    response.data.pipe(res);
    
  } catch (error) {
    console.error('Stream proxy error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Test endpoint
app.get("/api/test", (req, res) => {
  res.json({ 
    message: "🔥 Ultimate Proxy API is running!", 
    timestamp: new Date().toISOString(),
    supportedCDNs: CDN_DOMAINS,
    proxies: [
      '/api/proxy-video - HLS/M3U8 streams',
      '/api/proxy-pixeldrain - PixelDrain (India bypass)',
      '/api/proxy-stream - General streaming'
    ]
  });
});

// Create API routes
createApiRoutes(app, jsonResponse, jsonError);

// ========================================
// 404 HANDLER - MUST BE LAST
// ========================================
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔥 Ultimate Proxy enabled for CDN bypass`);
  console.log(`🇮🇳 PixelDrain proxy enabled for India`);
});
