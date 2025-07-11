// server.js - Erweiterte Version mit PostgreSQL
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
    
    // Fetch from Riot API (existing code)
    const axiosConfig = {
      headers: { 'X-Riot-Token': RIOT_API_KEY },
      timeout: 10000
    };
    
    // Get account, summoner, and mastery data (existing logic)
    // ... (keep existing Riot API calls)
    
    // Enhance with database champion info
    const championsResult = await pool.query('SELECT * FROM champions');
    const championMap = {};
    championsResult.rows.forEach(champ => {
      championMap[champ.key] = champ;
    });
    
    // Return combined data
    res.json({
      // ... existing player data
      champions: championMap,
      apiInfo: {
        rateLimits: 'Production API',
        dataSource: 'Riot API + PostgreSQL',
        server: 'Railway Production'
      }
    });
  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ error: 'Failed to fetch player data' });
  }
});

// Initialize translations
async function initTranslations() {
  const defaultTranslations = {
    en: {
      title: "LoL Arena Win Tracker",
      connect_account: "Connect Riot Account",
      load_mastery: "Load Mastery",
      arena_wins: "Arena Wins",
      champions: "Champions",
      with_mastery: "With Mastery",
      progress: "Progress",
      high_mastery: "High Mastery (50k+)",
      // ... add all translations
    },
    de: {
      title: "LoL Arena Win Tracker",
      connect_account: "Riot Account verbinden",
      load_mastery: "Mastery laden",
      arena_wins: "Arena Siege",
      champions: "Champions",
      with_mastery: "Mit Mastery",
      progress: "Fortschritt",
      high_mastery: "Hohe Mastery (50k+)",
      // ... add all translations
    }
  };

  for (const [lang, translations] of Object.entries(defaultTranslations)) {
    for (const [key, value] of Object.entries(translations)) {
      await pool.query(
        'INSERT INTO translations (lang_code, key, value) VALUES ($1, $2, $3) ON CONFLICT (lang_code, key) DO NOTHING',
        [lang, key, value]
      );
    }
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
  });
}

start();