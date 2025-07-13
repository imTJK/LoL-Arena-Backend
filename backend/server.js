// server.js - Rate Limit Optimized Version
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');
const cron = require('node-cron');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// PostgreSQL Connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// In-memory cache for API responses
const cache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// More restrictive rate limiting to prevent API abuse
const clientLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10, // Reduced from 20 to 10
  message: { error: 'Too many requests. Please wait 5 minutes before trying again.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/player', clientLimiter);

// Riot API Configuration
const RIOT_API_KEY = process.env.RIOT_API_KEY;
if (!RIOT_API_KEY || !RIOT_API_KEY.startsWith('RGAPI-')) {
  console.error('❌ Invalid or missing RIOT_API_KEY!');
  process.exit(1);
}

// Rate limiting for Riot API calls
let riotApiCalls = 0;
let lastResetTime = Date.now();
const RIOT_RATE_LIMIT = 100; // Personal API key: 100 requests per 2 minutes
const RIOT_WINDOW = 2 * 60 * 1000; // 2 minutes

function canMakeRiotCall() {
  const now = Date.now();
  
  // Reset counter if window expired
  if (now - lastResetTime > RIOT_WINDOW) {
    riotApiCalls = 0;
    lastResetTime = now;
  }
  
  return riotApiCalls < RIOT_RATE_LIMIT;
}

function incrementRiotCalls() {
  riotApiCalls++;
}

// Enhanced sleep function for retry logic
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Retry wrapper for Riot API calls
async function makeRiotApiCall(url, config, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      // Check rate limit before making call
      if (!canMakeRiotCall()) {
        console.log('⏳ Rate limit reached, waiting...');
        await sleep(10000); // Wait 10 seconds
        continue;
      }
      
      console.log(`🔄 API Call (attempt ${attempt}): ${url}`);
      incrementRiotCalls();
      
      const response = await axios.get(url, config);
      console.log(`✅ API Call successful`);
      return response;
      
    } catch (error) {
      console.log(`❌ API Call failed (attempt ${attempt}):`, error.response?.status, error.response?.data);
      
      if (error.response?.status === 429) {
        const retryAfter = error.response.headers['retry-after'] || 10;
        console.log(`⏳ Rate limited, waiting ${retryAfter} seconds...`);
        await sleep(retryAfter * 1000);
        continue;
      }
      
      if (error.response?.status === 404) {
        throw error; // Don't retry on 404
      }
      
      if (attempt === retries) {
        throw error;
      }
      
      // Exponential backoff
      await sleep(1000 * Math.pow(2, attempt));
    }
  }
}

// Cache helpers
function getCacheKey(type, ...params) {
  return `${type}:${params.join(':')}`;
}

function getFromCache(key) {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    console.log(`💾 Cache hit: ${key}`);
    return cached.data;
  }
  if (cached) {
    cache.delete(key); // Remove expired cache
  }
  return null;
}

function setCache(key, data) {
  cache.set(key, {
    data,
    timestamp: Date.now()
  });
  console.log(`💾 Cached: ${key}`);
}

// Database initialization (same as before)
async function initDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS champions (
        id SERIAL PRIMARY KEY,
        key VARCHAR(10) UNIQUE NOT NULL,
        name VARCHAR(50) NOT NULL,
        title VARCHAR(100),
        role VARCHAR(20),
        tags TEXT[],
        difficulty INTEGER,
        image_url VARCHAR(255),
        splash_art_url VARCHAR(255),
        lore TEXT,
        passive_name VARCHAR(100),
        passive_description TEXT,
        stats JSONB,
        spells JSONB,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_wins (
        id SERIAL PRIMARY KEY,
        user_identifier VARCHAR(100) NOT NULL,
        champion_key VARCHAR(10) NOT NULL,
        won BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_identifier, champion_key)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS translations (
        id SERIAL PRIMARY KEY,
        lang_code VARCHAR(5) NOT NULL,
        key VARCHAR(100) NOT NULL,
        value TEXT NOT NULL,
        UNIQUE(lang_code, key)
      )
    `);

    // Add API cache table for persistent caching
    await pool.query(`
      CREATE TABLE IF NOT EXISTS api_cache (
        id SERIAL PRIMARY KEY,
        cache_key VARCHAR(255) UNIQUE NOT NULL,
        data JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NOT NULL
      )
    `);

    console.log('✅ Database tables initialized');
  } catch (error) {
    console.error('❌ Database initialization error:', error);
  }
}

// Persistent cache functions
async function getPersistentCache(key) {
  try {
    const result = await pool.query(
      'SELECT data FROM api_cache WHERE cache_key = $1 AND expires_at > NOW()',
      [key]
    );
    
    if (result.rows.length > 0) {
      console.log(`💾 DB Cache hit: ${key}`);
      return result.rows[0].data;
    }
  } catch (error) {
    console.error('Cache read error:', error);
  }
  return null;
}

async function setPersistentCache(key, data, durationMs = CACHE_DURATION) {
  try {
    const expiresAt = new Date(Date.now() + durationMs);
    await pool.query(
      `INSERT INTO api_cache (cache_key, data, expires_at) 
       VALUES ($1, $2, $3) 
       ON CONFLICT (cache_key) 
       DO UPDATE SET data = $2, expires_at = $3, created_at = NOW()`,
      [key, JSON.stringify(data), expiresAt]
    );
    console.log(`💾 DB Cached: ${key}`);
  } catch (error) {
    console.error('Cache write error:', error);
  }
}

// API Routes (keeping existing ones, just showing the optimized player endpoint)

// Optimized player endpoint with caching and rate limiting
app.get('/api/player/:gameName/:tagLine/:region', async (req, res) => {
  try {
    const { gameName, tagLine, region } = req.params;
    const cacheKey = getCacheKey('player', gameName, tagLine, region);
    
    // Try memory cache first
    let cachedData = getFromCache(cacheKey);
    if (cachedData) {
      return res.json({
        ...cachedData,
        cached: true,
        cacheSource: 'memory'
      });
    }
    
    // Try persistent cache
    cachedData = await getPersistentCache(cacheKey);
    if (cachedData) {
      // Also put in memory cache
      setCache(cacheKey, cachedData);
      return res.json({
        ...cachedData,
        cached: true,
        cacheSource: 'database'
      });
    }
    
    console.log(`🔍 Fetching fresh data for: ${gameName}#${tagLine} in ${region}`);
    
    const axiosConfig = {
      headers: { 'X-Riot-Token': RIOT_API_KEY },
      timeout: 20000
    };

    // Step 1: Get account by Riot ID
    const accountResponse = await makeRiotApiCall(
      `https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
      axiosConfig
    );
    const account = accountResponse.data;
    console.log('✅ Account found:', account.puuid);

    // Step 2: Get summoner by PUUID
    const regionMap = {
      'euw1': 'euw1', 'eun1': 'eun1', 'na1': 'na1', 'kr': 'kr', 'jp1': 'jp1'
    };
    const platformId = regionMap[region] || region;

    const summonerResponse = await makeRiotApiCall(
      `https://${platformId}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${account.puuid}`,
      axiosConfig
    );
    const summoner = summonerResponse.data;
    console.log('✅ Summoner found:', summoner.name);

    // Step 3: Get champion masteries
    const masteryResponse = await makeRiotApiCall(
      `https://${platformId}.api.riotgames.com/lol/champion-mastery/v4/champion-masteries/by-puuid/${account.puuid}`,
      axiosConfig
    );
    console.log('✅ Masteries found:', masteryResponse.data.length);

    const responseData = {
      account,
      summoner,
      masteries: masteryResponse.data || [],
      apiInfo: {
        rateLimits: `${riotApiCalls}/${RIOT_RATE_LIMIT} calls used`,
        dataSource: 'Riot API + PostgreSQL',
        server: 'Railway Production',
        fresh: true
      }
    };

    // Cache the response
    setCache(cacheKey, responseData);
    await setPersistentCache(cacheKey, responseData, 10 * 60 * 1000); // 10 minutes

    res.json(responseData);

  } catch (error) {
    console.error('❌ API Error:', error.response?.data || error.message);
    
    if (error.response?.status === 404) {
      res.status(404).json({ 
        error: 'Player not found. Check the Riot ID format (Name#TAG)',
        details: 'Make sure the summoner name and tag are correct'
      });
    } else if (error.response?.status === 403) {
      res.status(403).json({ 
        error: 'API key issue',
        details: 'Our API key may be expired or invalid'
      });
    } else if (error.response?.status === 429) {
      res.status(429).json({ 
        error: 'Rate limit exceeded',
        details: 'Too many requests. Please try again in a few minutes.',
        retryAfter: error.response?.headers['retry-after'] || 60
      });
    } else {
      res.status(500).json({ 
        error: 'Failed to fetch player data',
        details: error.response?.data?.message || error.message
      });
    }
  }
});

// Clean up old cache entries
cron.schedule('0 */6 * * *', async () => {
  try {
    await pool.query('DELETE FROM api_cache WHERE expires_at < NOW()');
    console.log('🧹 Cache cleanup completed');
  } catch (error) {
    console.error('Cache cleanup error:', error);
  }
});

// Get all champions (existing code)
app.get('/api/champions', async (req, res) => {
  try {
    const { role, search, lang = 'en' } = req.query;
    
    let query = 'SELECT * FROM champions WHERE 1=1';
    const params = [];
    
    if (role && role !== 'all') {
      params.push(role);
      query += ` AND role = $${params.length}`;
    }
    
    if (search) {
      params.push(`%${search}%`);
      query += ` AND LOWER(name) LIKE LOWER($${params.length})`;
    }
    
    query += ' ORDER BY name ASC';
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching champions:', error);
    res.status(500).json({ error: 'Failed to fetch champions' });
  }
});

// User wins endpoints (same as before)
app.get('/api/wins/:userIdentifier', async (req, res) => {
  try {
    const { userIdentifier } = req.params;
    
    const result = await pool.query(
      'SELECT champion_key FROM user_wins WHERE user_identifier = $1 AND won = true',
      [userIdentifier]
    );
    
    const wins = result.rows.map(row => row.champion_key);
    res.json({ wins });
  } catch (error) {
    console.error('Error fetching wins:', error);
    res.status(500).json({ error: 'Failed to fetch wins' });
  }
});

app.post('/api/wins/:userIdentifier/:championKey', async (req, res) => {
  try {
    const { userIdentifier, championKey } = req.params;
    
    const existing = await pool.query(
      'SELECT * FROM user_wins WHERE user_identifier = $1 AND champion_key = $2',
      [userIdentifier, championKey]
    );
    
    if (existing.rows.length > 0) {
      const newStatus = !existing.rows[0].won;
      await pool.query(
        'UPDATE user_wins SET won = $1 WHERE user_identifier = $2 AND champion_key = $3',
        [newStatus, userIdentifier, championKey]
      );
      res.json({ won: newStatus });
    } else {
      await pool.query(
        'INSERT INTO user_wins (user_identifier, champion_key, won) VALUES ($1, $2, true)',
        [userIdentifier, championKey]
      );
      res.json({ won: true });
    }
  } catch (error) {
    console.error('Error toggling win:', error);
    res.status(500).json({ error: 'Failed to toggle win' });
  }
});

app.delete('/api/wins/:userIdentifier/:championKey', async (req, res) => {
  try {
    const { userIdentifier, championKey } = req.params;
    
    await pool.query(
      'UPDATE user_wins SET won = false WHERE user_identifier = $1 AND champion_key = $2',
      [userIdentifier, championKey]
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting win:', error);
    res.status(500).json({ error: 'Failed to delete win' });
  }
});

// Translations endpoint (same as before)
app.get('/api/translations/:lang', async (req, res) => {
  try {
    const { lang } = req.params;
    
    const result = await pool.query(
      'SELECT key, value FROM translations WHERE lang_code = $1',
      [lang]
    );
    
    const translations = {};
    result.rows.forEach(row => {
      translations[row.key] = row.value;
    });
    
    res.json(translations);
  } catch (error) {
    console.error('Error fetching translations:', error);
    res.status(500).json({ error: 'Failed to fetch translations' });
  }
});

// Initialize translations (same as before but condensed)
async function initTranslations() {
  const translations = {
    en: {
      title: "LoL Arena Win Tracker", connect_account: "Connect Riot Account",
      riot_id_placeholder: "Summoner Name#TAG", load_mastery: "Load Mastery",
      mastery_loaded: "Mastery data loaded!", arena_wins: "Arena Wins",
      champions: "Champions", progress: "Progress", all: "All",
      completed: "Won", pending: "Pending", high_mastery: "High Mastery (50k+)",
      assassin: "Assassin", fighter: "Fighter", mage: "Mage",
      marksman: "Marksman", support: "Support", tank: "Tank",
      sort_by: "Sort by:", alphabetical: "Alphabetical",
      mastery_points: "Mastery Points", mastery_level: "Mastery Level",
      last_played: "Last Played", loading: "Loading mastery data...",
      reset_progress: "Reset Arena Progress", load_demo: "Load Demo Data",
      level: "Level", points: "Points", reset_confirm: "Do you really want to reset your Arena progress?",
      error: "Error", riot_id_format: "Riot ID must have format 'Name#TAG'",
      search_placeholder: "Search champion...", arena_god_challenge: "Arena God Challenge"
    },
    de: {
      title: "LoL Arena Win Tracker", connect_account: "Riot Account verbinden",
      riot_id_placeholder: "Beschwörername#TAG", load_mastery: "Mastery laden",
      mastery_loaded: "Mastery Daten geladen!", arena_wins: "Arena Siege",
      champions: "Champions", progress: "Fortschritt", all: "Alle",
      completed: "Gewonnen", pending: "Offen", high_mastery: "Hohe Mastery (50k+)",
      assassin: "Assassine", fighter: "Kämpfer", mage: "Magier",
      marksman: "Schütze", support: "Unterstützer", tank: "Tank",
      sort_by: "Sortierung:", alphabetical: "Alphabetisch",
      mastery_points: "Mastery Punkte", mastery_level: "Mastery Level",
      last_played: "Zuletzt gespielt", loading: "Lade Mastery Daten...",
      reset_progress: "Arena Fortschritt zurücksetzen", load_demo: "Demo Daten laden",
      level: "Level", points: "Punkte", reset_confirm: "Willst du wirklich den Arena Fortschritt zurücksetzen?",
      error: "Fehler", riot_id_format: "Riot ID muss Format 'Name#TAG' haben",
      search_placeholder: "Champion suchen...", arena_god_challenge: "Arena Gott Herausforderung"
    }
  };

  for (const [lang, trans] of Object.entries(translations)) {
    for (const [key, value] of Object.entries(trans)) {
      await pool.query(
        'INSERT INTO translations (lang_code, key, value) VALUES ($1, $2, $3) ON CONFLICT (lang_code, key) DO UPDATE SET value = $3',
        [lang, key, value]
      );
    }
  }
}

// Health check with rate limit info
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ 
      status: 'OK',
      database: 'connected',
      riotApiCalls: `${riotApiCalls}/${RIOT_RATE_LIMIT}`,
      cacheSize: cache.size,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'ERROR',
      database: 'disconnected',
      timestamp: new Date().toISOString()
    });
  }
});

// Map role function (same as before)
function mapRole(tag) {
  const roleMap = {
    'Fighter': 'fighter', 'Tank': 'tank', 'Mage': 'mage',
    'Assassin': 'assassin', 'Support': 'support', 'Marksman': 'marksman'
  };
  return roleMap[tag] || 'fighter';
}

// Champion update function (simplified)
async function updateChampionsData() {
  try {
    console.log('🔄 Updating champions data...');
    const versionResponse = await axios.get('https://ddragon.leagueoflegends.com/api/versions.json');
    const latestVersion = versionResponse.data[0];
    
    const championsResponse = await axios.get(
      `https://ddragon.leagueoflegends.com/cdn/${latestVersion}/data/en_US/champion.json`
    );
    
    const champions = Object.values(championsResponse.data.data);
    
    for (const champ of champions) {
      await pool.query(`
        INSERT INTO champions (key, name, role, image_url) 
        VALUES ($1, $2, $3, $4) 
        ON CONFLICT (key) DO UPDATE SET name = $2, role = $3, image_url = $4
      `, [
        champ.key, champ.name, mapRole(champ.tags[0]),
        `https://ddragon.leagueoflegends.com/cdn/${latestVersion}/img/champion/${champ.id}.png`
      ]);
    }
    
    console.log('✅ Champions updated');
  } catch (error) {
    console.error('❌ Champion update error:', error);
  }
}

// Start server
async function start() {
  await initDatabase();
  await initTranslations();
  
  if (process.env.UPDATE_ON_START === 'true') {
    await updateChampionsData();
  }
  
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📊 PostgreSQL connected`);
    console.log(`💾 Caching enabled (Memory + DB)`);
    console.log(`⚡ Rate limiting: ${RIOT_RATE_LIMIT} calls per ${RIOT_WINDOW/1000/60} minutes`);
  });
}

start();