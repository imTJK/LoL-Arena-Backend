// server.js - LoL Arena Backend - Railway Production Ready
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

// Rate Limiting für Client
const clientLimiter = rateLimit({
  windowMs: 2 * 60 * 1000, // 2 Minuten
  max: 20, // Max 20 requests pro 2 min pro IP
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

if (!RIOT_API_KEY) {
  console.error('❌ RIOT_API_KEY fehlt in Environment Variables!');
  process.exit(1);
}

if (!RIOT_API_KEY.startsWith('RGAPI-')) {
  console.error('❌ RIOT_API_KEY hat falsches Format! Muss mit RGAPI- beginnen');
  process.exit(1);
}

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
        return res.status(429).json({ error: 'Rate Limit erreicht', details: 'Zu viele Anfragen, warte kurz' });
      default:
        return res.status(status).json({ error: 'Riot API Fehler', details: message });
    }
  }
  
  console.error('Network Error:', error.message);
  return res.status(500).json({ error: 'Netzwerk-Fehler', details: 'Riot API nicht erreichbar' });
};

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
        dataSource: 'Official Riot API',
        server: 'Railway Production'
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

// 🔍 Account by Riot ID (funktioniert einzeln)
app.get('/api/account/:gameName/:tagLine/:region', async (req, res) => {
  try {
    const { gameName, tagLine, region } = req.params;
    
    const regionalEndpoint = getRegionalEndpoint(region);
    const url = `https://${REGIONS[regionalEndpoint]}/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
    
    const response = await axios.get(url, {
      headers: { 'X-Riot-Token': RIOT_API_KEY },
      timeout: 10000
    });
    
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
    server: 'Railway Production',
    version: '2.0.0'
  });
});

// 📖 API Documentation
app.get('/', (req, res) => {
  res.json({
    name: 'LoL Arena Backend API',
    version: '2.0.0',
    server: 'Railway Production',
    features: ['Personal Product API Integration', 'PUUID-based Mastery', 'Production Rate Limits'],
    endpoints: {
      'GET /api/player/:gameName/:tagLine/:region': 'Komplette Spieler-Daten (empfohlen)',
      'GET /api/account/:gameName/:tagLine/:region': 'Account by Riot ID',
      'GET /health': 'Server Status'
    },
    examples: {
      player: '/api/player/Hide on bush/KR1/kr',
      account: '/api/account/Faker/KR1/kr',
      health: '/health'
    },
    regions: {
      platform: ['euw1', 'eun1', 'na1', 'kr', 'jp1'],
      supported: 'EUW, EUNE, NA, Korea, Japan'
    },
    deployment: {
      platform: 'Railway',
      url: 'https://lol-arena-backend-production.up.railway.app',
      status: 'Production Ready'
    }
  });
});

// 404 Handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Endpoint nicht gefunden' });
});

// Server starten
app.listen(PORT, () => {
  console.log(`🚀 LoL Arena Backend läuft auf Port ${PORT}`);
  console.log(`📖 API Dokumentation: https://lol-arena-backend-production.up.railway.app`);
  console.log(`🔑 API Key: ${RIOT_API_KEY ? '✅ konfiguriert' : '❌ fehlt'}`);
  console.log(`🌐 Railway Production Server - Ready!`);
});