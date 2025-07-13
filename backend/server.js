// server.js - Fixed with complete translations
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

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Rate Limiting
const clientLimiter = rateLimit({
  windowMs: 2 * 60 * 1000,
  max: 20,
  message: { error: 'Too many requests. Wait 2 minutes.' }
});
app.use('/api', clientLimiter);

// Riot API Configuration
const RIOT_API_KEY = process.env.RIOT_API_KEY;
if (!RIOT_API_KEY || !RIOT_API_KEY.startsWith('RGAPI-')) {
  console.error('❌ Invalid or missing RIOT_API_KEY!');
  process.exit(1);
}

// Database initialization
async function initDatabase() {
  try {
    // Champions table
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

    // User wins tracking
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

    // Translations table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS translations (
        id SERIAL PRIMARY KEY,
        lang_code VARCHAR(5) NOT NULL,
        key VARCHAR(100) NOT NULL,
        value TEXT NOT NULL,
        UNIQUE(lang_code, key)
      )
    `);

    console.log('✅ Database tables initialized');
  } catch (error) {
    console.error('❌ Database initialization error:', error);
  }
}

// Update champions from Data Dragon
async function updateChampionsData() {
  try {
    console.log('🔄 Updating champions data...');
    
    // Get latest version
    const versionResponse = await axios.get('https://ddragon.leagueoflegends.com/api/versions.json');
    const latestVersion = versionResponse.data[0];
    
    // Get champions data
    const championsResponse = await axios.get(
      `https://ddragon.leagueoflegends.com/cdn/${latestVersion}/data/en_US/champion.json`
    );
    
    const champions = Object.values(championsResponse.data.data);
    
    // Update each champion
    for (const champ of champions) {
      // Get detailed champion data
      const detailResponse = await axios.get(
        `https://ddragon.leagueoflegends.com/cdn/${latestVersion}/data/en_US/champion/${champ.id}.json`
      );
      
      const detailed = detailResponse.data.data[champ.id];
      
      await pool.query(`
        INSERT INTO champions (key, name, title, role, tags, difficulty, image_url, splash_art_url, lore, passive_name, passive_description, stats, spells)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (key) DO UPDATE SET
          name = $2, title = $3, role = $4, tags = $5, difficulty = $6,
          image_url = $7, splash_art_url = $8, lore = $9,
          passive_name = $10, passive_description = $11,
          stats = $12, spells = $13, updated_at = CURRENT_TIMESTAMP
      `, [
        champ.key,
        champ.name,
        detailed.title,
        mapRole(detailed.tags[0]), // Map primary tag to our role system
        detailed.tags,
        detailed.info.difficulty,
        `https://ddragon.leagueoflegends.com/cdn/${latestVersion}/img/champion/${champ.id}.png`,
        `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${champ.id}_0.jpg`,
        detailed.lore,
        detailed.passive.name,
        detailed.passive.description,
        JSON.stringify(detailed.stats),
        JSON.stringify(detailed.spells)
      ]);
    }
    
    console.log('✅ Champions data updated successfully');
  } catch (error) {
    console.error('❌ Error updating champions:', error);
  }
}

// Map Riot tags to our role system
function mapRole(tag) {
  const roleMap = {
    'Fighter': 'fighter',
    'Tank': 'tank',
    'Mage': 'mage',
    'Assassin': 'assassin',
    'Support': 'support',
    'Marksman': 'marksman'
  };
  return roleMap[tag] || 'fighter';
}

// API Routes

// Get all champions with optional filters
app.get('/api/champions', async (req, res) => {
  try {
    const { role, search, lang = 'en' } = req.query;
    
    let query = 'SELECT * FROM champions WHERE 1=1';
    const params = [];
    
    if (role && role !== 'all') {
      params.push(role);
      query += ` AND role = ${params.length}`;
    }
    
    if (search) {
      params.push(`%${search}%`);
      query += ` AND LOWER(name) LIKE LOWER(${params.length})`;
    }
    
    query += ' ORDER BY name ASC';
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching champions:', error);
    res.status(500).json({ error: 'Failed to fetch champions' });
  }
});

// Get user wins
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

// Toggle win status
app.post('/api/wins/:userIdentifier/:championKey', async (req, res) => {
  try {
    const { userIdentifier, championKey } = req.params;
    
    // Check if entry exists
    const existing = await pool.query(
      'SELECT * FROM user_wins WHERE user_identifier = $1 AND champion_key = $2',
      [userIdentifier, championKey]
    );
    
    if (existing.rows.length > 0) {
      // Toggle existing
      const newStatus = !existing.rows[0].won;
      await pool.query(
        'UPDATE user_wins SET won = $1 WHERE user_identifier = $2 AND champion_key = $3',
        [newStatus, userIdentifier, championKey]
      );
      res.json({ won: newStatus });
    } else {
      // Create new
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

// Delete win (for reset functionality)
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

// Get translations
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

// Combined endpoint for player data with champion info
app.get('/api/player/:gameName/:tagLine/:region', async (req, res) => {
  try {
    const { gameName, tagLine, region } = req.params;
    
    const axiosConfig = {
      headers: { 'X-Riot-Token': RIOT_API_KEY },
      timeout: 15000
    };

    console.log(`🔍 Fetching data for: ${gameName}#${tagLine} in ${region}`);

    // Step 1: Get account by Riot ID
    const accountResponse = await axios.get(
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

    const summonerResponse = await axios.get(
      `https://${platformId}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${account.puuid}`,
      axiosConfig
    );
    const summoner = summonerResponse.data;
    console.log('✅ Summoner found:', summoner.name);

    // Step 3: Get champion masteries
    const masteryResponse = await axios.get(
      `https://${platformId}.api.riotgames.com/lol/champion-mastery/v4/champion-masteries/by-puuid/${account.puuid}`,
      axiosConfig
    );
    console.log('✅ Masteries found:', masteryResponse.data.length);

    res.json({
      account,
      summoner,
      masteries: masteryResponse.data || [], // Ensure it's always an array
      apiInfo: {
        rateLimits: 'Production API',
        dataSource: 'Riot API + PostgreSQL',
        server: 'Railway Production'
      }
    });
  } catch (error) {
    console.error('❌ API Error:', error.response?.data || error.message);
    if (error.response?.status === 404) {
      res.status(404).json({ error: 'Player not found. Check the Riot ID format (Name#TAG)' });
    } else if (error.response?.status === 403) {
      res.status(403).json({ error: 'API key expired or invalid' });
    } else if (error.response?.status === 429) {
      res.status(429).json({ error: 'Rate limit exceeded. Please try again later.' });
    } else {
      res.status(500).json({ error: 'Failed to fetch player data: ' + (error.response?.data?.message || error.message) });
    }
  }
});

// Initialize translations with complete data
async function initTranslations() {
  const defaultTranslations = {
    en: {
      title: "LoL Arena Win Tracker",
      connect_account: "Connect Riot Account",
      riot_id_placeholder: "Summoner Name#TAG",
      load_mastery: "Load Mastery",
      mastery_loaded: "Mastery data loaded!",
      arena_wins: "Arena Wins",
      champions: "Champions",
      with_mastery: "With Mastery",
      progress: "Progress",
      all: "All",
      completed: "Won",
      pending: "Pending",
      high_mastery: "High Mastery (50k+)",
      assassin: "Assassin",
      fighter: "Fighter",
      mage: "Mage",
      marksman: "Marksman",
      support: "Support",
      tank: "Tank",
      sort_by: "Sort by:",
      alphabetical: "Alphabetical",
      mastery_points: "Mastery Points",
      mastery_level: "Mastery Level",
      last_played: "Last Played",
      loading: "Loading mastery data...",
      reset_progress: "Reset Arena Progress",
      load_demo: "Load Demo Data",
      level: "Level",
      points: "Points",
      last: "Last",
      reset_confirm: "Do you really want to reset your Arena progress?",
      error: "Error",
      riot_id_format: "Riot ID must have format 'Name#TAG'",
      search_placeholder: "Search champion...",
      arena_god_challenge: "Arena God Challenge",
      bronze_milestone: "10 Wins - Bronze Arena God",
      silver_milestone: "25 Wins - Silver Arena God",
      gold_milestone: "45 Wins - Gold Arena God",
      ultimate_milestone: "60 Wins - ULTIMATE ARENA GOD!"
    },
    de: {
      title: "LoL Arena Win Tracker",
      connect_account: "Riot Account verbinden",
      riot_id_placeholder: "Beschwörername#TAG",
      load_mastery: "Mastery laden",
      mastery_loaded: "Mastery Daten geladen!",
      arena_wins: "Arena Siege",
      champions: "Champions",
      with_mastery: "Mit Mastery",
      progress: "Fortschritt",
      all: "Alle",
      completed: "Gewonnen",
      pending: "Offen",
      high_mastery: "Hohe Mastery (50k+)",
      assassin: "Assassine",
      fighter: "Kämpfer",
      mage: "Magier",
      marksman: "Schütze",
      support: "Unterstützer",
      tank: "Tank",
      sort_by: "Sortierung:",
      alphabetical: "Alphabetisch",
      mastery_points: "Mastery Punkte",
      mastery_level: "Mastery Level",
      last_played: "Zuletzt gespielt",
      loading: "Lade Mastery Daten...",
      reset_progress: "Arena Fortschritt zurücksetzen",
      load_demo: "Demo Daten laden",
      level: "Level",
      points: "Punkte",
      last: "Zuletzt",
      reset_confirm: "Willst du wirklich den Arena Fortschritt zurücksetzen?",
      error: "Fehler",
      riot_id_format: "Riot ID muss Format 'Name#TAG' haben",
      search_placeholder: "Champion suchen...",
      arena_god_challenge: "Arena Gott Herausforderung",
      bronze_milestone: "10 Siege - Bronze Arena Gott",
      silver_milestone: "25 Siege - Silber Arena Gott",
      gold_milestone: "45 Siege - Gold Arena Gott",
      ultimate_milestone: "60 Siege - ULTIMATIVER ARENA GOTT!"
    }
  };

  try {
    for (const [lang, translations] of Object.entries(defaultTranslations)) {
      for (const [key, value] of Object.entries(translations)) {
        await pool.query(
          `INSERT INTO translations (lang_code, key, value) 
           VALUES ($1, $2, $3) 
           ON CONFLICT (lang_code, key) 
           DO UPDATE SET value = $3`,
          [lang, key, value]
        );
      }
    }
    console.log('✅ Translations initialized');
  } catch (error) {
    console.error('❌ Error initializing translations:', error);
  }
}

// Schedule nightly updates (2 AM)
cron.schedule('0 2 * * *', () => {
  console.log('🌙 Running nightly champion data update...');
  updateChampionsData();
});

// Health check
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ 
      status: 'OK',
      database: 'connected',
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

// API info endpoint
app.get('/api/info', (req, res) => {
  res.json({
    version: '2.0.0',
    features: ['PostgreSQL', 'Translations', 'Win Tracking', 'Champion Data'],
    endpoints: ['/api/champions', '/api/wins', '/api/translations', '/api/player'],
    status: 'Production Ready'
  });
});

// Start server
async function start() {
  await initDatabase();
  await initTranslations();
  
  // Update champions on first start
  if (process.env.UPDATE_ON_START === 'true') {
    await updateChampionsData();
  }
  
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📊 PostgreSQL connected`);
    console.log(`🔄 Nightly updates scheduled`);
    console.log(`🌍 Translations: EN, DE`);
  });
}

start();