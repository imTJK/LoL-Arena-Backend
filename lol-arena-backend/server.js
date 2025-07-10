// server.js - LoL Arena Backend mit intelligenter Rate Limiting
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Security & Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Rate Limiting für Client (schützt vor zu vielen Anfragen)
const clientLimiter = rateLimit({
  windowMs: 2 * 60 * 1000, // 2 Minuten
  max: 10, // Max 10 requests pro 2 min pro IP
  message: { error: 'Zu viele Anfragen. Warte 2 Minuten.' }
});
app.use('/api', clientLimiter);

// Riot API Configuration mit besserer Validation
const RIOT_API_KEY = process.env.RIOT_API_KEY;

console.log('🔑 API Key Debug:');
console.log('  - Exists:', !!RIOT_API_KEY);
console.log('  - Length:', RIOT_API_KEY?.length);
console.log('  - Starts with RGAPI:', RIOT_API_KEY?.startsWith('RGAPI-'));
console.log('  - First 15 chars:', RIOT_API_KEY?.substring(0, 15));
console.log('  - Has whitespace:', RIOT_API_KEY ? /\s/.test(RIOT_API_KEY) : 'N/A');

if (!RIOT_API_KEY) {
  console.error('❌ RIOT_API_KEY fehlt in .env Datei!');
  process.exit(1);
}

if (!RIOT_API_KEY.startsWith('RGAPI-')) {
  console.error('❌ RIOT_API_KEY hat falsches Format! Muss mit RGAPI- beginnen');
  process.exit(1);
}

if (RIOT_API_KEY.length < 40) {
  console.error('❌ RIOT_API_KEY zu kurz! Sollte ca. 42 Zeichen haben');
  process.exit(1);
}

// Rate Limiting für Riot API - Ultra Conservative
class RiotApiQueue {
  constructor() {
    this.personalQueue = []; // Personal API Key: 100 calls / 2 minutes
    this.lastCall = 0;
    this.callCount = 0;
    this.resetTime = Date.now() + (2 * 60 * 1000);
    this.isProcessing = false;
    
    // Verarbeite Queue alle 3 Sekunden (sehr konservativ)
    setInterval(() => this.processQueue(), 3000);
  }

  async makeRequest(url, headers) {
    return new Promise((resolve, reject) => {
      this.personalQueue.push({ 
        url, 
        headers, 
        resolve, 
        reject,
        timestamp: Date.now()
      });
      console.log(`📝 Request queued. Queue length: ${this.personalQueue.length}`);
    });
  }

  async processQueue() {
    if (this.isProcessing || this.personalQueue.length === 0) {
      return;
    }

    const now = Date.now();
    
    // Reset call count alle 2 Minuten
    if (now > this.resetTime) {
      this.callCount = 0;
      this.resetTime = now + (2 * 60 * 1000);
      console.log('🔄 Rate limit counter reset');
    }

    // Sehr konservatives Limit: nur 80 calls per 2 minutes
    if (this.callCount >= 80) {
      console.log(`⚠️ Approaching rate limit (${this.callCount}/80). Waiting for reset...`);
      return;
    }

    // Mindestens 3 Sekunden zwischen Calls
    const timeSinceLastCall = now - this.lastCall;
    if (timeSinceLastCall < 3000) {
      console.log(`⏳ Waiting ${3000 - timeSinceLastCall}ms before next call`);
      return;
    }

    this.isProcessing = true;
    const request = this.personalQueue.shift();
    
    try {
      console.log(`📞 API Call ${this.callCount + 1}/80 - Queue: ${this.personalQueue.length}`);
      console.log(`🔗 URL: ${request.url}`);
      console.log(`🔑 Headers:`, request.headers);
      
      const response = await axios.get(request.url, {
        headers: {
          'X-Riot-Token': request.headers['X-Riot-Token'],
          'User-Agent': 'LoL-Arena-Tracker/1.0',
          'Accept': 'application/json'
        },
        timeout: 15000 // Längeres Timeout
      });
      
      this.callCount++;
      this.lastCall = now;
      request.resolve(response);
      
      console.log(`✅ API Call successful. Next call in 3 seconds.`);
      
    } catch (error) {
      console.error(`❌ API Call failed:`, error.response?.status, error.response?.data);
      console.error(`❌ Request headers were:`, request.headers);
      
      // Bei Rate Limit oder anderen kritischen Fehlern
      if (error.response?.status === 429) {
        console.log('🚨 Rate limit hit! Requeuing request and waiting 60 seconds...');
        this.personalQueue.unshift(request); // Zurück an den Anfang
        
        // Force reset bei Rate Limit
        this.callCount = 80; // Block weitere Calls
        setTimeout(() => {
          this.callCount = 0; // Reset nach 60 Sekunden
          this.resetTime = Date.now() + (2 * 60 * 1000);
        }, 60000);
        
      } else if (error.response?.status === 403 || error.response?.status === 401) {
        console.log('🚨 Auth error - API Key problem');
        console.log('🔑 Used API Key:', request.headers['X-Riot-Token']?.substring(0, 15) + '...');
        request.reject(new Error('API Key Problem: ' + (error.response?.data?.status?.message || 'Unauthorized')));
        
      } else {
        request.reject(error);
      }
    } finally {
      this.isProcessing = false;
    }
  }

  getQueueStatus() {
    return {
      queueLength: this.personalQueue.length,
      callCount: this.callCount,
      maxCalls: 80,
      resetTime: this.resetTime,
      timeUntilReset: Math.max(0, this.resetTime - Date.now()),
      isProcessing: this.isProcessing,
      lastCall: this.lastCall,
      timeSinceLastCall: Date.now() - this.lastCall
    };
  }

  // Manueller Reset für Debugging
  forceReset() {
    this.callCount = 0;
    this.resetTime = Date.now() + (2 * 60 * 1000);
    this.personalQueue = [];
    console.log('🔄 Manual queue reset');
  }
}

const riotQueue = new RiotApiQueue();

const REGIONS = {
  // Platform Routing (für Summoner, Mastery etc.)
  'euw1': 'euw1.api.riotgames.com',
  'eun1': 'eun1.api.riotgames.com', 
  'na1': 'na1.api.riotgames.com',
  'kr': 'kr.api.riotgames.com',
  'jp1': 'jp1.api.riotgames.com',
  
  // Regional Routing (für Account API)
  'europe': 'europe.api.riotgames.com',
  'americas': 'americas.api.riotgames.com',
  'asia': 'asia.api.riotgames.com'
};

// Region Mapping für Account API - KORRIGIERT
const getRegionalEndpoint = (platformRegion) => {
  console.log(`🌍 Input region: ${platformRegion}`);
  let regional;
  
  if (['euw1', 'eun1'].includes(platformRegion)) {
    regional = 'europe';
  } else if (['na1', 'br1', 'la1', 'la2', 'oc1'].includes(platformRegion)) {
    regional = 'americas';
  } else if (['kr', 'jp1', 'ph2', 'sg2', 'th2', 'tw2', 'vn2'].includes(platformRegion)) {
    regional = 'asia';
  } else {
    console.log(`⚠️ Unknown region ${platformRegion}, defaulting to europe`);
    regional = 'europe';
  }
  
  console.log(`🌍 Mapped ${platformRegion} -> ${regional}`);
  return regional;
};

// Error Handler für Riot API
const handleRiotError = (error, res) => {
  if (error.response) {
    const status = error.response.status;
    const message = error.response.data?.status?.message || error.message;
    
    switch (status) {
      case 400:
        return res.status(400).json({ error: 'Ungültige Anfrage', details: message });
      case 401:
        return res.status(500).json({ error: 'API Key Problem', details: 'Server-Konfiguration fehlerhaft' });
      case 403:
        return res.status(403).json({ error: 'Zugriff verweigert', details: 'API Rate Limit erreicht' });
      case 404:
        return res.status(404).json({ error: 'Spieler nicht gefunden', details: 'Riot ID existiert nicht' });
      case 429:
        return res.status(429).json({ 
          error: 'Rate Limit erreicht', 
          details: 'Zu viele API-Calls. Anfrage wird in der Warteschlange verarbeitet.',
          queueStatus: riotQueue.getQueueStatus()
        });
      default:
        return res.status(status).json({ error: 'Riot API Fehler', details: message });
    }
  }
  
  console.error('Network Error:', error.message);
  return res.status(500).json({ error: 'Netzwerk-Fehler', details: 'Riot API nicht erreichbar' });
};

// 🔄 Manual Reset Endpoint (für Debugging)
app.post('/api/reset-queue', (req, res) => {
  riotQueue.forceReset();
  res.json({ 
    message: 'Queue manuell zurückgesetzt',
    status: riotQueue.getQueueStatus()
  });
});

// 📊 Queue Status Endpoint
app.get('/api/status', (req, res) => {
  const status = riotQueue.getQueueStatus();
  res.json({
    status: 'OK',
    riotApi: status,
    timestamp: new Date().toISOString(),
    recommendations: {
      safe: status.callCount < 60,
      waitTime: status.timeUntilReset < 30000 ? 'Queue fast resetted' : `${Math.round(status.timeUntilReset/1000)}s until reset`
    }
  });
});

// 🎯 HAUPTROUTE: Komplette Spieler-Daten laden (mit korrekten APIs)
app.get('/api/player/:gameName/:tagLine/:region', async (req, res) => {
  try {
    const { gameName, tagLine, region } = req.params;
    
    console.log(`🔍 Lade Daten für: ${gameName}#${tagLine} (${region})`);
    
    // Verwende die funktionierende Konfiguration
    const axiosConfig = {
      headers: {
        'X-Riot-Token': RIOT_API_KEY
      },
      timeout: 10000
    };
    
    // 1. Account via Riot ID holen (funktioniert!)
    const regionalEndpoint = getRegionalEndpoint(region);
    const accountUrl = `https://${REGIONS[regionalEndpoint]}/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
    
    console.log('📞 Account API Call:', accountUrl);
    const accountResponse = await axios.get(accountUrl, axiosConfig);
    
    const account = accountResponse.data;
    console.log(`✅ Account gefunden: ${account.puuid}`);
    
    // Warte 1 Sekunde zwischen Calls
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 2. Summoner Daten holen (by PUUID - du hast Permission!)
    const summonerUrl = `https://${REGIONS[region]}/lol/summoner/v4/summoners/by-puuid/${account.puuid}`;
    
    console.log('📞 Summoner API Call:', summonerUrl);
    const summonerResponse = await axios.get(summonerUrl, axiosConfig);
    
    const summoner = summonerResponse.data;
    console.log(`✅ Summoner gefunden: ${summoner.name} (Level ${summoner.summonerLevel})`);
    
    // Warte weitere 1 Sekunde
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 3. Champion Mastery Daten holen (by PUUID - du hast Permission!)
    const masteryUrl = `https://${REGIONS[region]}/lol/champion-mastery/v4/champion-masteries/by-puuid/${account.puuid}`;
    
    console.log('📞 Mastery API Call:', masteryUrl);
    const masteryResponse = await axios.get(masteryUrl, axiosConfig);
    
    const masteries = masteryResponse.data;
    console.log(`✅ Mastery geladen: ${masteries.length} Champions`);
    
    // 4. Daten zusammenfassen
    const playerData = {
      account: {
        gameName: account.gameName,
        tagLine: account.tagLine,
        puuid: account.puuid
      },
      summoner: {
        id: summoner.id,
        name: summoner.name,
        summonerLevel: summoner.summonerLevel,
        profileIconId: summoner.profileIconId
      },
      masteries: masteries.map(m => ({
        championId: m.championId.toString(),
        championLevel: m.championLevel,
        championPoints: m.championPoints,
        lastPlayTime: m.lastPlayTime,
        championPointsSinceLastLevel: m.championPointsSinceLastLevel || 0,
        championPointsUntilNextLevel: m.championPointsUntilNextLevel || 0,
        tokensEarned: m.tokensEarned || 0
      })),
      region: region,
      loadedAt: new Date().toISOString(),
      apiInfo: {
        rateLimits: 'Production API - High limits',
        dataSource: 'Official Riot API'
      }
    };
    
    res.json(playerData);
    
  } catch (error) {
    console.error('❌ API Error:', error.message);
    console.error('❌ Response:', error.response?.data);
    console.error('❌ Status:', error.response?.status);
    handleRiotError(error, res);
  }
});

// 🎯 ALTERNATIVE: Nur Account-Lookup (funktioniert!)
app.get('/api/account/:gameName/:tagLine/:region', async (req, res) => {
  try {
    const { gameName, tagLine, region } = req.params;
    
    const regionalEndpoint = getRegionalEndpoint(region);
    const accountUrl = `https://${REGIONS[regionalEndpoint]}/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
    
    const response = await axios.get(accountUrl, {
      headers: { 'X-Riot-Token': RIOT_API_KEY },
      timeout: 10000
    });
    
    res.json(response.data);
  } catch (error) {
    handleRiotError(error, res);
  }
});

// 🔍 Einzelne Endpunkte (auch mit Queue)

// Account by Riot ID
app.get('/api/account/:gameName/:tagLine/:regionalEndpoint', async (req, res) => {
  try {
    const { gameName, tagLine, regionalEndpoint } = req.params;
    
    const url = `https://${REGIONS[regionalEndpoint]}/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
    
    const response = await riotQueue.makeRequest(url, { 'X-Riot-Token': RIOT_API_KEY });
    
    res.json(response.data);
  } catch (error) {
    handleRiotError(error, res);
  }
});

// Summoner by PUUID
app.get('/api/summoner/:puuid/:region', async (req, res) => {
  try {
    const { puuid, region } = req.params;
    
    const url = `https://${REGIONS[region]}/lol/summoner/v4/summoners/by-puuid/${puuid}`;
    
    const response = await riotQueue.makeRequest(url, { 'X-Riot-Token': RIOT_API_KEY });
    
    res.json(response.data);
  } catch (error) {
    handleRiotError(error, res);
  }
});

// Champion Mastery by Summoner ID
app.get('/api/mastery/:summonerId/:region', async (req, res) => {
  try {
    const { summonerId, region } = req.params;
    
    const url = `https://${REGIONS[region]}/lol/champion-mastery/v4/champion-masteries/by-summoner/${summonerId}`;
    
    const response = await riotQueue.makeRequest(url, { 'X-Riot-Token': RIOT_API_KEY });
    
    res.json(response.data);
  } catch (error) {
    handleRiotError(error, res);
  }
});

// 📊 Health Check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    apiKey: RIOT_API_KEY ? 'configured' : 'missing',
    queue: riotQueue.getQueueStatus()
  });
});

// 📖 API Documentation
app.get('/', (req, res) => {
  res.json({
    name: 'LoL Arena Backend API',
    version: '2.0.0',
    features: ['Rate Limited Queue', 'Intelligent Request Batching'],
    endpoints: {
      'GET /api/player/:gameName/:tagLine/:region': 'Komplette Spieler-Daten (empfohlen)',
      'GET /api/account/:gameName/:tagLine/:regionalEndpoint': 'Account by Riot ID',
      'GET /api/summoner/:puuid/:region': 'Summoner by PUUID', 
      'GET /api/mastery/:summonerId/:region': 'Champion Mastery',
      'GET /api/status': 'Queue Status',
      'GET /health': 'Server Status'
    },
    examples: {
      player: '/api/player/Hide on bush/KR1/kr',
      account: '/api/account/Faker/KR1/asia',
      status: '/api/status'
    },
    regions: {
      platform: Object.keys(REGIONS).filter(r => r !== 'europe' && r !== 'americas' && r !== 'asia'),
      regional: ['europe', 'americas', 'asia']
    },
    currentQueue: riotQueue.getQueueStatus()
  });
});

// 404 Handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Endpoint nicht gefunden' });
});

// Server starten
app.listen(PORT, () => {
  console.log(`🚀 LoL Arena Backend läuft auf Port ${PORT}`);
  console.log(`📖 API Dokumentation: http://localhost:${PORT}`);
  console.log(`🔑 API Key: ${RIOT_API_KEY ? '✅ konfiguriert' : '❌ fehlt'}`);
  console.log(`⚡ Rate Limiting: Aktiviert (Queue-basiert)`);
});