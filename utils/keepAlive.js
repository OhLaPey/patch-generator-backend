/**
 * PPATCH - Keep Alive
 * 
 * Ping le serveur toutes les 10 minutes pour éviter
 * que Render ne le mette en pause (plan gratuit).
 * 
 * À importer dans server.js :
 * import './utils/keepAlive.js';
 */

const PING_INTERVAL = 10 * 60 * 1000; // 10 minutes en millisecondes
const SERVER_URL = process.env.SERVER_URL || 'https://patch-generator-api.onrender.com';

async function ping() {
  try {
    const response = await fetch(`${SERVER_URL}/health`);
    const timestamp = new Date().toISOString();
    
    if (response.ok) {
      console.log(`[${timestamp}] 💚 Keep-alive ping OK`);
    } else {
      console.log(`[${timestamp}] ⚠️ Keep-alive ping: ${response.status}`);
    }
  } catch (error) {
    console.log(`[${new Date().toISOString()}] ❌ Keep-alive ping failed: ${error.message}`);
  }
}

// Démarrer le cron
function startKeepAlive() {
  console.log(`🏃 Keep-alive démarré (ping toutes les ${PING_INTERVAL / 60000} minutes)`);
  console.log(`   URL: ${SERVER_URL}/health`);
  
  // Premier ping après 1 minute (laisser le serveur démarrer)
  setTimeout(ping, 60 * 1000);
  
  // Puis toutes les 10 minutes
  setInterval(ping, PING_INTERVAL);
}

// Démarrer automatiquement
startKeepAlive();

export { ping, startKeepAlive };
