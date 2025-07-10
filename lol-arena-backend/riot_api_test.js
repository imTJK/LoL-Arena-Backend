// test-riot-api.js - Einfacher Test für Riot API
const axios = require('axios');
require('dotenv').config();

const API_KEY = process.env.RIOT_API_KEY;

console.log('🔑 Testing Riot API...');
console.log('API Key:', API_KEY ? `${API_KEY.substring(0, 15)}...` : 'MISSING');
console.log('Key length:', API_KEY?.length);

async function testRiotApi() {
  // Test 1: Einfachster Account-Call
  const testUrl = 'https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/Faker/KR1';
  
  console.log('\n📞 Testing URL:', testUrl);
  
  try {
    const response = await axios.get(testUrl, {
      headers: {
        'X-Riot-Token': API_KEY
      },
      timeout: 10000
    });
    
    console.log('✅ SUCCESS!');
    console.log('Status:', response.status);
    console.log('Data:', response.data);
    
  } catch (error) {
    console.log('❌ FAILED!');
    console.log('Status:', error.response?.status);
    console.log('Status Text:', error.response?.statusText);
    console.log('Error Data:', error.response?.data);
    console.log('Headers sent:', error.config?.headers);
    
    // Teste verschiedene Problemlösungen
    if (error.response?.status === 403) {
      console.log('\n🔍 Testing alternative approaches...');
      
      // Test 2: Mit anderem User-Agent
      try {
        console.log('Testing with User-Agent...');
        const response2 = await axios.get(testUrl, {
          headers: {
            'X-Riot-Token': API_KEY,
            'User-Agent': 'LoL-Arena-Tracker/1.0'
          }
        });
        console.log('✅ User-Agent helped!', response2.status);
      } catch (e) {
        console.log('❌ User-Agent didn\'t help');
      }
      
      // Test 3: Mit trimmed API Key
      try {
        console.log('Testing with trimmed API key...');
        const response3 = await axios.get(testUrl, {
          headers: {
            'X-Riot-Token': API_KEY.trim()
          }
        });
        console.log('✅ Trimming helped!', response3.status);
      } catch (e) {
        console.log('❌ Trimming didn\'t help');
      }
      
      // Test 4: Anderer Endpoint
      try {
        console.log('Testing different endpoint...');
        const altUrl = 'https://euw1.api.riotgames.com/lol/status/v4/platform-data';
        const response4 = await axios.get(altUrl, {
          headers: {
            'X-Riot-Token': API_KEY
          }
        });
        console.log('✅ Alternative endpoint works!', response4.status);
      } catch (e) {
        console.log('❌ Alternative endpoint failed:', e.response?.status);
      }
    }
  }
}

// Test direkt ausführen
testRiotApi().then(() => {
  console.log('\n🏁 Test completed');
}).catch(err => {
  console.error('Test crashed:', err.message);
});