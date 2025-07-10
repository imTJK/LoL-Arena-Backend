// comprehensive-test.js - Test für Personal Product API Key
const axios = require('axios');
require('dotenv').config();

const API_KEY = process.env.RIOT_API_KEY;

console.log('🔑 API Key Info:');
console.log('  Length:', API_KEY?.length);
console.log('  Preview:', API_KEY ? `${API_KEY.substring(0, 20)}...` : 'MISSING');
console.log('  Format - RGAPI:', API_KEY?.startsWith('RGAPI-'));
console.log('  Format - Bearer:', !API_KEY?.startsWith('RGAPI-') && API_KEY?.length > 20);

// Test verschiedene Authentifizierungs-Methoden
const authMethods = [
  {
    name: 'X-Riot-Token (Development)',
    headers: { 'X-Riot-Token': API_KEY }
  },
  {
    name: 'Authorization Bearer (Production)',  
    headers: { 'Authorization': `Bearer ${API_KEY}` }
  },
  {
    name: 'Authorization (Raw)',
    headers: { 'Authorization': API_KEY }
  }
];

const testEndpoints = [
  {
    name: 'Status (No Auth)',
    url: 'https://euw1.api.riotgames.com/lol/status/v4/platform-data',
    needsAuth: false
  },
  {
    name: 'Account API - Faker (Asia)',
    url: 'https://asia.api.riotgames.com/riot/account/v1/accounts/by-riot-id/Faker/KR1',
    needsAuth: true
  },
  {
    name: 'Summoner by Name',
    url: 'https://euw1.api.riotgames.com/lol/summoner/v4/summoners/by-name/RiotGames',
    needsAuth: true
  }
];

async function testEndpoint(endpoint, authMethod = null) {
  console.log(`\n🧪 Testing: ${endpoint.name}`);
  if (authMethod) {
    console.log(`🔐 Auth Method: ${authMethod.name}`);
  }
  console.log(`📞 URL: ${endpoint.url}`);
  
  const config = {
    timeout: 10000,
    headers: {}
  };
  
  if (endpoint.needsAuth && authMethod) {
    config.headers = { ...authMethod.headers };
  }
  
  try {
    const response = await axios.get(endpoint.url, config);
    console.log(`✅ SUCCESS - Status: ${response.status}`);
    
    if (response.data.puuid) {
      console.log(`   PUUID: ${response.data.puuid}`);
    }
    if (response.data.gameName) {
      console.log(`   Player: ${response.data.gameName}#${response.data.tagLine}`);
    }
    
    return { success: true, status: response.status };
    
  } catch (error) {
    console.log(`❌ FAILED - Status: ${error.response?.status}`);
    console.log(`   Error: ${error.response?.data?.status?.message || error.message}`);
    console.log(`   Headers sent:`, Object.keys(config.headers));
    
    if (error.response?.status === 401) {
      console.log(`   🚨 401 = Unauthorized (Wrong auth method/invalid key)`);
    } else if (error.response?.status === 403) {
      console.log(`   🚨 403 = Forbidden (No permission for this endpoint)`);
    }
    
    return { success: false, status: error.response?.status };
  }
}

async function runComprehensiveTest() {
  console.log('🚀 Testing Personal Product API Key...\n');
  
  // Test 1: No Auth endpoint first
  await testEndpoint(testEndpoints[0]);
  
  // Test 2: Try all auth methods on authenticated endpoints
  for (const endpoint of testEndpoints.slice(1)) {
    console.log(`\n📋 Testing endpoint: ${endpoint.name}`);
    console.log('=====================================');
    
    let foundWorkingAuth = false;
    
    for (const authMethod of authMethods) {
      const result = await testEndpoint(endpoint, authMethod);
      
      if (result.success) {
        console.log(`🎉 WORKING AUTH METHOD FOUND: ${authMethod.name}`);
        foundWorkingAuth = true;
        break;
      }
      
      // Kurze Pause zwischen Versuchen
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    if (!foundWorkingAuth) {
      console.log(`💀 No working auth method for ${endpoint.name}`);
    }
    
    // Pause zwischen Endpoints
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('\n🏁 Comprehensive test completed');
  console.log('\n💡 Next steps:');
  console.log('   - If Bearer auth works: Update backend to use Authorization header');
  console.log('   - If nothing works: Check Personal Product settings in Riot Developer Portal');
  console.log('   - Verify your Personal Product has correct permissions');
}

// Run the test
runComprehensiveTest().catch(err => {
  console.error('💥 Test crashed:', err.message);
});