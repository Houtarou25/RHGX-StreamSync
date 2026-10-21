const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const ai = require('./ai');
const minigames = require('./minigames');
const db = require('./database');

const CONFIG_FILE = path.join(__dirname, 'config.json');

// Default Configuration
let config = {
    apiKey: "",
    aiModel: "gemini-flash-latest",
    streamerBotPort: 9001,
    channelName: "",
    persona: "friendly",
    links: { ig: "", yt: "", twitch: "", kick: "", discord: "", web: "", kofi: "" },
    extraKnowledge: "",
    triggerMode: "strict",
    triggerPrefix: "!bot",
    minPermissions: "everyone",
    blacklist: "",
    eventReactions: true,
    minigamesEnabled: true,
    actionRedemptions: "sus:0, wow:0, ara:0",
    pointsPerMin: 2,
    kofiVerificationToken: "",
    gambleMin: 10,
    gambleMax: 10000,
    gambleMul1: 0,
    gambleMul2: 0,
    gambleMul3: 2,
    gambleMul4: 2,
    gambleMul5: 3,
    heistMin: 50,
    heistMax: 5000,
    heistChance: 40,
    heistTime: 30
};

// Load saved configuration from disk if available
try {
    if (fs.existsSync(CONFIG_FILE)) {
        const savedConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
        config = { ...config, ...savedConfig };
        console.log('📁 [CONFIG] Loaded saved configuration from config.json');
    } else {
        const exampleFile = path.join(__dirname, 'config.example.json');
        if (fs.existsSync(exampleFile)) {
            fs.copyFileSync(exampleFile, CONFIG_FILE);
            console.log('📁 [CONFIG] Created initial config.json from config.example.json');
        }
    }
} catch (e) {
    console.error('⚠️ [CONFIG] Failed to load config.json:', e.message);
}

function saveConfigToDisk() {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
    } catch (e) {
        console.error('⚠️ [CONFIG] Failed to save config.json:', e.message);
    }
}

let botClient = null;
let reconnectTimer = null;
let currentConnectedPort = null;
let isIntentionalDisconnect = false;

// Real-time telemetry counters
let statsData = {
    aiResponses: 0,
    minigamesPlayed: 0
};

const mimeTypes = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

// --- HTTP SERVER ---
const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, GET, POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') return res.writeHead(204).end();

    const reqUrl = new URL(req.url, 'http://' + (req.headers.host || 'localhost:8081'));
    const pathname = reqUrl.pathname;

    // Config endpoint
    if (req.method === 'GET' && pathname === '/config') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(config));
    }

    // Live Stats & Telemetry endpoint
    if (req.method === 'GET' && (pathname === '/api/stats' || pathname === '/stats')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        const dbStats = db.getStats();
        const leaderboard = db.getLeaderboard(50);
        return res.end(JSON.stringify({
            aiResponses: statsData.aiResponses,
            minigamesPlayed: statsData.minigamesPlayed,
            totalUsers: dbStats.totalUsers,
            totalPoints: dbStats.totalPoints,
            leaderboard: leaderboard,
            botConnected: botClient && botClient.readyState === WebSocket.OPEN,
            persona: config.persona,
            channelName: config.channelName,
            streamerBotPort: config.streamerBotPort,
            uptime: Math.floor(process.uptime())
        }));
    }

    // Update Config endpoint
    if (req.method === 'POST' && pathname === '/update-config') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const payload = JSON.parse(body);
                if (payload.action === "RESET_POINTS") {
                    db.resetAllPoints();
                    broadcastToOverlay('points_reset', {});
                    return res.writeHead(200).end('Points Reset');
                }
                config = { ...config, ...payload };
                saveConfigToDisk();
                console.log('\n🟢 [SYSTEM] Memory updated from Dashboard and saved to disk!');
                
                const newPort = parseInt(config.streamerBotPort, 10) || 9001;
                if (newPort !== currentConnectedPort || !botClient || botClient.readyState !== WebSocket.OPEN) {
                    connectToStreamerBot(newPort);
                }
                
                broadcastToOverlay('config_updated', { persona: config.persona });
                res.writeHead(200).end('Config Saved');
            } catch (err) {
                res.writeHead(400).end('Invalid Payload');
            }
        });
        return;
    }

    // --- KO-FI WEBHOOK ENDPOINT (Real-time live stream donations) ---
    if (req.method === 'POST' && (pathname === '/api/kofi-webhook' || pathname === '/kofi-webhook')) {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                let payload = null;
                if (body.startsWith('data=')) {
                    const rawJson = decodeURIComponent(body.slice(5).replace(/\+/g, ' '));
                    payload = JSON.parse(rawJson);
                } else {
                    payload = JSON.parse(body);
                }

                // Verify token if configured
                if (config.kofiVerificationToken && payload.verification_token !== config.kofiVerificationToken) {
                    console.log('⚠️ [KO-FI] Received webhook with invalid verification token.');
                    res.writeHead(403).end('Forbidden');
                    return;
                }

                const donor = payload.from_name || 'Anonymous Supporter';
                const amount = payload.amount || '0.00';
                const currency = payload.currency || 'USD';
                const message = payload.message || '';
                const type = payload.type || 'Donation';

                console.log(`\n💖 [KO-FI ${type.toUpperCase()}]: ${donor} sent ${currency} ${amount}! "${message}"\n`);

                // 1. Award loyalty points (100 points per $1)
                const numericAmount = parseFloat(amount) || 0;
                const bonusPoints = Math.round(numericAmount * 100);
                if (bonusPoints > 0) {
                    db.updatePoints(donor, bonusPoints);
                }

                // 2. Broadcast live donation alert to OBS overlay
                broadcastToOverlay('donation', {
                    donor,
                    amount,
                    currency,
                    message,
                    bonusPoints,
                    type
                });

                // 3. Post thank you message in stream chat
                const thankMsg = `💖 Thank you @${donor} for the ${currency} ${amount} on Ko-fi! "${message}" (+${bonusPoints} pts awarded!)`;
                replyToChat('Kick', thankMsg);
                replyToChat('Twitch', thankMsg);
                replyToChat('YouTube', thankMsg);

                // 4. Trigger celebration sound in Streamer.bot if 'wow' or audio action exists
                triggerStreamerBotAction('wow', { donor, amount, currency });

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'ok', received: true }));
            } catch (err) {
                console.error('⚠️ [KO-FI] Error processing webhook payload:', err.message);
                res.writeHead(400).end('Bad Request');
            }
        });
        return;
    }

    // Serve Static Files with Clean URL Routing
    if (req.method === 'GET') {
        let safePath = pathname;
        if (safePath === '/' || safePath === '/index' || safePath === '/home') {
            safePath = '/index.html';
        } else if (safePath === '/dashboard') {
            safePath = '/dashboard.html';
        } else if (safePath === '/overlay') {
            safePath = '/overlay.html';
        }

        const filePath = path.join(__dirname, path.normalize(safePath).replace(/^(\.\.[\/\\])+/, ''));
        const ext = path.extname(filePath).toLowerCase();

        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            const contentType = mimeTypes[ext] || 'application/octet-stream';
            res.writeHead(200, { 'Content-Type': contentType });
            fs.createReadStream(filePath).pipe(res);
            return;
        }
    }

    res.writeHead(404).end('Not Found');
});

// --- OBS WEBSOCKET SERVER ---
const obsServer = new WebSocket.Server({ server });

obsServer.on('connection', (socket) => {
    console.log('🟢 OBS Overlay Connected via WebSocket!');
    socket.send(JSON.stringify({
        type: 'init',
        data: {
            status: 'online',
            persona: config.persona,
            channelName: config.channelName
        }
    }));
});

function broadcastToOverlay(type, data) {
    const payload = JSON.stringify({ type, data, timestamp: Date.now() });
    obsServer.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    });
}

const PORT = parseInt(process.env.PORT, 10) || 8081;
const HOST = process.env.HOST || '0.0.0.0';

server.listen(PORT, HOST, () => {
    console.log(`\n=================================================`);
    console.log(`  RHGX StreamSync v3.1 [READY TO DEPLOY]`);
    console.log(`=================================================`);
    console.log(`  🌐 Home Page:      http://localhost:${PORT}/`);
    console.log(`  🎛️  Dashboard:      http://localhost:${PORT}/dashboard.html`);
    console.log(`  📺 OBS Overlay:    http://localhost:${PORT}/overlay.html`);
    console.log(`  ⚙️  Config API:     http://localhost:${PORT}/config`);
    console.log(`  📊 Stats API:      http://localhost:${PORT}/api/stats`);
    console.log(`=================================================\n`);
    connectToStreamerBot(config.streamerBotPort);
});

// --- STREAMER.BOT CONNECTION WITH AUTO-RECONNECT ---
function connectToStreamerBot(port) {
    const targetPort = parseInt(port, 10) || 9001;

    // Prevent reconnect loop if already connected or connecting to the exact same port
    if (botClient && currentConnectedPort === targetPort && (botClient.readyState === WebSocket.OPEN || botClient.readyState === WebSocket.CONNECTING)) {
        return;
    }

    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }

    if (botClient) {
        isIntentionalDisconnect = true;
        botClient.removeAllListeners();
        try {
            botClient.close();
        } catch (e) {}
        botClient = null;
    }

    currentConnectedPort = targetPort;
    isIntentionalDisconnect = false;

    const ws = new WebSocket(`ws://127.0.0.1:${targetPort}`);
    botClient = ws;

    ws.on('open', () => {
        if (botClient !== ws) return;
        console.log(`✅ Connected to Streamer.bot on port ${targetPort}! Listening for chat...`);
        ws.send(JSON.stringify({
            "request": "Subscribe",
            "events": { 
                "YouTube": ["Message"], 
                "Twitch": ["ChatMessage"], 
                "Kick": ["ChatMessage"] 
            },
            "id": "HoutarouBot"
        }));
    });

    ws.on('message', handleChat);
    
    ws.on('close', () => {
        if (isIntentionalDisconnect || botClient !== ws) return;
        botClient = null;
        currentConnectedPort = null;
        console.log(`⚠️ Disconnected from Streamer.bot (port ${targetPort}). Reconnecting in 5s...`);
        if (!reconnectTimer) {
            reconnectTimer = setTimeout(() => {
                reconnectTimer = null;
                connectToStreamerBot(targetPort);
            }, 5000);
        }
    });

    ws.on('error', () => {
        // Will be followed by 'close'
    });
}

// Send actual message BACK to chat via Streamer.bot Action
function replyToChat(platform, messageText) {
    if (!botClient || botClient.readyState !== WebSocket.OPEN) {
        console.log(`⚠️ Cannot reply: Streamer.bot not connected.`);
        return;
    }

    const platformLower = (platform || '').toLowerCase();
    
    let actionName = null;
    if (platformLower === 'kick') actionName = 'AI_Reply_Kick';
    else if (platformLower === 'twitch') actionName = 'AI_Reply_Twitch';
    else if (platformLower === 'youtube') actionName = 'AI_Reply_YouTube';

    if (actionName) {
        botClient.send(JSON.stringify({
            "request": "DoAction",
            "id": "HoutarouBot-ReplyAction",
            "action": { "name": actionName },
            "args": { 
                "ai_reply": messageText,
                "message": messageText
            }
        }));
    }

    console.log(`\n💬 [BOT REPLY -> ${platform}]: ${messageText}\n`);
}

// Trigger Streamer.bot Action (e.g. for audio redemptions like 'sus', 'wow', 'ara')
function triggerStreamerBotAction(actionName, args = {}) {
    if (!botClient || botClient.readyState !== WebSocket.OPEN) {
        console.log(`⚠️ Cannot trigger action '${actionName}': Streamer.bot not connected.`);
        return false;
    }

    botClient.send(JSON.stringify({
        "request": "DoAction",
        "id": "HoutarouBot-RedeemAction",
        "action": { "name": actionName },
        "args": args
    }));

    console.log(`🚀 [STREAMER.BOT ACTION]: Triggered '${actionName}'`);
    return true;
}

const userCooldowns = new Map();
const userRandomCooldowns = new Map();
let lastGlobalAiCall = 0;
let lastRandomChimeIn = 0;
const KNOWN_BOTS = ['houtarou25bot', 'botrix', 'nightbot', 'streamelements', 'streamlabs', 'moobot'];

// Bulletproof Chat Parser
function handleChat(data) {
    let payload;
    try {
        payload = JSON.parse(data);
    } catch(e) { return; }

    if (payload.id === "HoutarouBot") {
        console.log(`📝 Streamer.bot accepted subscription! Events active:`, payload.events);
        return;
    }

    // Log Streamer.bot's response to reply and redemption requests
    if (payload.id === "HoutarouBot-ReplyAction" || payload.id === "HoutarouBot-RedeemAction") {
        if (payload.status === "error") {
            console.log(`⚠️ Streamer.bot reply (${payload.id}): ${payload.error}`);
        } else if (payload.status === "ok") {
            console.log(`✅ Streamer.bot action executed successfully (${payload.id})!`);
        }
        return;
    }

    if (!payload.event) return;

    let user = "Unknown";
    let msg = "";
    let platform = payload.event.source;
    let d = payload.data || {}; 
    const src = (platform || '').toLowerCase();

    try {
        if (src === 'youtube' && payload.event.type === 'Message') {
            user = d.user?.name || d.user?.displayName || d.author?.name || d.author?.displayString || "YouTube Viewer";
            msg = (typeof d.message === 'string' ? d.message : d.message?.message) || d.snippet?.displayMessage || d.text || "";
        } 
        else if (src === 'twitch' && payload.event.type === 'ChatMessage') {
            if (typeof d.message === 'string') {
                msg = d.message;
                user = d.user?.displayName || d.user?.name || d.displayName || d.username || "Twitch Viewer";
            } else if (d.message && typeof d.message === 'object') {
                user = d.message.displayName || d.message.username || d.user?.displayName || d.user?.name || "Twitch Viewer";
                msg = d.message.message || d.message.text || d.message.msg || "";
            } else {
                user = d.displayName || d.username || d.user?.displayName || d.user?.name || "Twitch Viewer";
                msg = d.text || d.msg || "";
            }
        } 
        else if (src === 'kick' && payload.event.type === 'ChatMessage') {
            user = d.user?.name || d.user?.login || d.sender?.username || "Kick Viewer"; 
            msg = d.text || (typeof d.message === 'string' ? d.message : d.message?.text) || "";
        }
    } catch (error) {
        console.log("❌ Parsing error: ", error.message);
    }

    // Force msg to be a string just in case
    if (typeof msg === 'object') msg = JSON.stringify(msg);

    // Filter out messages from bot accounts
    const userLower = (user || '').toLowerCase();
    if (KNOWN_BOTS.includes(userLower) || (config.blacklist && config.blacklist.toLowerCase().includes(userLower))) {
        return;
    }

    // Check if we successfully parsed the message
    if (user !== "Unknown" && msg.trim() !== "") {
        console.log(`[${platform}] ${user}: ${msg}`);

        const now = Date.now();
        const prefix = (config.triggerPrefix || '!bot').toLowerCase();

        // 1. Explicit AI Trigger (e.g. "!bot hey")
        if (msg.toLowerCase().startsWith(prefix)) {
            const userLast = userCooldowns.get(userLower) || 0;
            // 4-second cooldown per user to prevent rate limit spikes
            if (now - userLast < 4000) {
                console.log(`⏳ Cooldown active for @${user} (skipping AI trigger).`);
                return;
            }
            userCooldowns.set(userLower, now);
            lastGlobalAiCall = now;

            statsData.aiResponses++;
            ai.generateResponse(config, platform, user, msg, replyToChat, 0, broadcastToOverlay);
        } 
        // 2. Minigame and Redemption Commands (starts with '!')
        else if (msg.startsWith('!')) {
            statsData.minigamesPlayed++;
            const args = msg.trim().split(/\s+/);
            const cmd = args[0].toLowerCase();
            minigames.processCommand(config, platform, user, cmd, args, replyToChat, broadcastToOverlay, triggerStreamerBotAction);
        }
        // 3. Random message chime-in (Low-token AI reaction)
        else if (config.triggerMode === 'random') {
            const words = msg.trim().split(/\s+/);
            const isSubstantive = words.length >= 3 && msg.length >= 10 && msg.length <= 150;
            const timeSinceLastChime = now - lastRandomChimeIn;
            const timeSinceUserChime = now - (userRandomCooldowns.get(userLower) || 0);

            // Minimum 45s global cooldown, 90s per-user cooldown, 15% probability
            if (isSubstantive && timeSinceLastChime > 45000 && timeSinceUserChime > 90000 && Math.random() < 0.15) {
                lastRandomChimeIn = now;
                userRandomCooldowns.set(userLower, now);
                statsData.aiResponses++;
                console.log(`🎲 [RANDOM CHIME-IN] Triggered on @${user}'s message: "${msg}"`);
                ai.generateRandomChimeIn(config, platform, user, msg, replyToChat, broadcastToOverlay);
            }
        }
    } else {
        console.log(`⚠️ Empty message parsed! Raw data:`);
        console.log(JSON.stringify(d, null, 2));
    }
}
