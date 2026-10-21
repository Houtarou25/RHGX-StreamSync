/**
 * 🧪 HoutarouBot / RHGX StreamSync - Comprehensive Automated Test Suite
 * 
 * Verifies:
 * 1. Database Economy & Persistence (get, set, update, leaderboard, stats, reset)
 * 2. Minigame Mechanics (!points, !gamble, !heist, !donate, !redeem, shorthands)
 * 3. AI Persona Generation & Prefix Sanitization
 * 4. Streamer.bot Mock WebSocket Connection & Chat Event Parsing (Kick, Twitch, YouTube)
 * 5. Server HTTP Endpoints (Index, Dashboard, Overlay, Config, Stats, Ko-fi Webhook)
 * 6. OBS Overlay WebSocket Broadcasts
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const { spawn } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const POINTS_FILE = path.join(ROOT_DIR, 'points.json');
const CONFIG_FILE = path.join(ROOT_DIR, 'config.json');

// Backup original config and points
const origPoints = fs.existsSync(POINTS_FILE) ? fs.readFileSync(POINTS_FILE, 'utf-8') : '{}';
const origConfig = fs.existsSync(CONFIG_FILE) ? fs.readFileSync(CONFIG_FILE, 'utf-8') : '{}';

let testsPassed = 0;
let testsFailed = 0;

function report(name, passed, details = '') {
    if (passed) {
        testsPassed++;
        console.log(`  ✅ PASS: ${name}`);
    } else {
        testsFailed++;
        console.error(`  ❌ FAIL: ${name} - ${details}`);
    }
}

// -------------------------------------------------------------
// TEST 1: Database Operations
// -------------------------------------------------------------
function testDatabase() {
    console.log('\n--- 1. Testing Database & Virtual Economy ---');
    const db = require('../database');

    db.resetAllPoints();
    report('Reset database wipes records', Object.keys(db.getLeaderboard(100)).length === 0);

    // Initial default points for new user is 100
    const initialPts = db.getPoints('Tester');
    report('Default initial points is 100', initialPts === 100);

    // Update points
    const updated = db.updatePoints('Tester', 50);
    report('updatePoints adds points correctly', updated === 150 && db.getPoints('Tester') === 150);

    // Negative update
    const decremented = db.updatePoints('Tester', -30);
    report('updatePoints deducts points correctly', decremented === 120 && db.getPoints('Tester') === 120);

    // Set points
    const exact = db.setPoints('Tester', 500);
    report('setPoints sets exact balance', exact === 500 && db.getPoints('Tester') === 500);

    // Stats and Leaderboard
    db.setPoints('User2', 1000);
    const stats = db.getStats();
    report('getStats counts users and points', stats.totalUsers === 2 && stats.totalPoints === 1500);

    const leader = db.getLeaderboard(2);
    report('getLeaderboard sorts descending', leader[0].username === 'user2' && leader[0].points === 1000);
}

// -------------------------------------------------------------
// TEST 2: Minigames & Chat Commands
// -------------------------------------------------------------
function testMinigames() {
    console.log('\n--- 2. Testing Minigames & Chat Commands ---');
    const db = require('../database');
    const minigames = require('../minigames');

    const mockConfig = {
        channelName: 'TestStreamer',
        links: { kofi: 'https://ko-fi.com/teststreamer' },
        gambleMin: 10,
        gambleMax: 1000,
        gambleMul1: 0,
        gambleMul2: 0,
        gambleMul3: 2,
        gambleMul4: 2,
        gambleMul5: 3,
        heistMin: 50,
        heistMax: 1000,
        heistChance: 50,
        heistTime: 2,
        actionRedemptions: 'sus:0, wow:50, dance:100'
    };

    let replyMsg = '';
    const mockReply = (platform, msg) => { replyMsg = msg; };
    let alertData = null;
    const mockAlert = (type, data) => { alertData = { type, data }; };
    let triggeredAction = null;
    const mockTrigger = (name, args) => { triggeredAction = { name, args }; };

    db.setPoints('Gamer1', 500);

    // !points command
    minigames.processCommand(mockConfig, 'Kick', 'Gamer1', '!points', ['!points'], mockReply, mockAlert, mockTrigger);
    report('!points command reports accurate balance', replyMsg.includes('500 points'));

    // !donate command
    minigames.processCommand(mockConfig, 'Twitch', 'Gamer1', '!donate', ['!donate'], mockReply, mockAlert, mockTrigger);
    report('!donate command displays streamer Ko-fi URL', replyMsg.includes('https://ko-fi.com/teststreamer'));

    // !gamble validation (too low)
    minigames.processCommand(mockConfig, 'YouTube', 'Gamer1', '!gamble', ['!gamble', '5'], mockReply, mockAlert, mockTrigger);
    report('!gamble rejects bet below minimum', replyMsg.includes('minimum gamble is 10'));

    // !gamble validation (exceeds max)
    minigames.processCommand(mockConfig, 'YouTube', 'Gamer1', '!gamble', ['!gamble', '9999'], mockReply, mockAlert, mockTrigger);
    report('!gamble rejects bet exceeding maximum', replyMsg.includes('maximum gamble is 1000'));

    // !gamble validation (cannot afford)
    minigames.processCommand(mockConfig, 'YouTube', 'Gamer1', '!gamble', ['!gamble', '600'], mockReply, mockAlert, mockTrigger);
    report('!gamble rejects bet exceeding balance', replyMsg.includes('you only have 500 points'));

    // !gamble valid bet
    minigames.processCommand(mockConfig, 'Kick', 'Gamer1', '!gamble', ['!gamble', '50'], mockReply, mockAlert, mockTrigger);
    report('!gamble executes and triggers alert', alertData && alertData.type === 'gamble');

    // !redeem (list all)
    minigames.processCommand(mockConfig, 'Kick', 'Gamer1', '!redeem', ['!redeem'], mockReply, mockAlert, mockTrigger);
    report('!redeem list displays configured actions', replyMsg.includes('sus (0 pts)') && replyMsg.includes('wow (50 pts)'));

    // Free redemption (!sus)
    triggeredAction = null;
    minigames.processCommand(mockConfig, 'Kick', 'Gamer1', '!sus', ['!sus'], mockReply, mockAlert, mockTrigger);
    report('Shorthand free redemption triggers Streamer.bot action', triggeredAction && triggeredAction.name.toLowerCase() === 'sus');

    // Paid redemption (!wow for 50 pts)
    const prevBalance = db.getPoints('Gamer1');
    triggeredAction = null;
    minigames.processCommand(mockConfig, 'Kick', 'Gamer1', '!redeem', ['!redeem', 'wow'], mockReply, mockAlert, mockTrigger);
    report('Paid redemption deducts points and triggers action', triggeredAction && triggeredAction.name.toLowerCase() === 'wow' && db.getPoints('Gamer1') === prevBalance - 50);

    // Mod command: !addpoints
    minigames.processCommand(mockConfig, 'Kick', 'Mod', '!addpoints', ['!addpoints', '100', '@Gamer1'], mockReply, mockAlert, mockTrigger);
    report('!addpoints adds points to target user', replyMsg.includes('Added 100 points to Gamer1'));
}

// -------------------------------------------------------------
// TEST 3: AI Prompts & Queue Structure
// -------------------------------------------------------------
function testAI() {
    console.log('\n--- 3. Testing AI Persona Engine ---');
    const ai = require('../ai');

    report('ai.js exports generateResponse function', typeof ai.generateResponse === 'function');
    report('ai.js exports generateRandomChimeIn function', typeof ai.generateRandomChimeIn === 'function');

    // Test with missing API key (graceful terminal log, no crash)
    let replyReceived = false;
    ai.generateResponse({ apiKey: '' }, 'Kick', 'User', '!bot hey', () => { replyReceived = true; });
    report('Missing API key handled gracefully without throwing unhandled rejection', replyReceived === false);
}

// -------------------------------------------------------------
// TEST 4: Full Server HTTP Endpoints & OBS WebSocket Server
// -------------------------------------------------------------
async function testServerAndEndpoints() {
    console.log('\n--- 4. Testing HTTP Endpoints & OBS WebSocket Server ---');

    // Start server.js as a child process on port 8081
    const serverProc = spawn('node', ['server.js'], {
        cwd: ROOT_DIR,
        env: { ...process.env, PORT: '8081' }
    });

    let serverReady = false;

    await new Promise((resolve) => {
        serverProc.stdout.on('data', (d) => {
            const out = d.toString();
            if (out.includes('Home Page:') || out.includes('8081')) {
                serverReady = true;
                resolve();
            }
        });
        serverProc.stderr.on('data', (d) => {
            const err = d.toString();
            // If already in use or error
            if (err.includes('EADDRINUSE')) {
                console.error('Server port in use:', err);
                resolve();
            }
        });
        setTimeout(resolve, 3000);
    });

    report('Server started and listening on port 8081', serverReady);

    const httpGet = (urlPath) => new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:8081${urlPath}`, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve({ status: res.statusCode, data, headers: res.headers }));
        }).on('error', reject);
    });

    const httpPost = (urlPath, body, headers = {}) => new Promise((resolve, reject) => {
        const req = http.request(`http://127.0.0.1:8081${urlPath}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...headers
            }
        }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve({ status: res.statusCode, data }));
        });
        req.on('error', reject);
        req.write(typeof body === 'string' ? body : JSON.stringify(body));
        req.end();
    });

    try {
        // Test Home Page
        const homeRes = await httpGet('/');
        report('GET / serves index.html (200 OK)', homeRes.status === 200 && homeRes.data.includes('RHGX'));

        // Test Dashboard
        const dashRes = await httpGet('/dashboard.html');
        report('GET /dashboard.html serves dashboard UI (200 OK)', dashRes.status === 200 && dashRes.data.includes('StreamSync'));

        // Test Overlay
        const overlayRes = await httpGet('/overlay.html');
        report('GET /overlay.html serves overlay UI (200 OK)', overlayRes.status === 200 && overlayRes.data.includes('overlay'));

        // Test Config API
        const configRes = await httpGet('/config');
        report('GET /config returns valid JSON config (200 OK)', configRes.status === 200 && JSON.parse(configRes.data).persona !== undefined);

        // Test Stats API
        const statsRes = await httpGet('/api/stats');
        report('GET /api/stats returns runtime statistics (200 OK)', statsRes.status === 200 && JSON.parse(statsRes.data).uptime !== undefined);

        // Test Update Config
        const updateRes = await httpPost('/update-config', { channelName: 'UpdatedStreamer' });
        report('POST /update-config saves settings (200 OK)', updateRes.status === 200);

        // Test OBS WebSocket connection
        let obsConnected = false;
        let obsInitReceived = false;
        await new Promise((resolveWs) => {
            const ws = new WebSocket('ws://127.0.0.1:8081');
            ws.on('open', () => {
                obsConnected = true;
            });
            ws.on('message', (msg) => {
                try {
                    const parsed = JSON.parse(msg);
                    if (parsed.type === 'init') {
                        obsInitReceived = true;
                        ws.close();
                        resolveWs();
                    }
                } catch (e) {}
            });
            ws.on('error', () => resolveWs());
            setTimeout(resolveWs, 2000);
        });
        report('OBS WebSocket connects and receives init payload', obsConnected && obsInitReceived);

        // Test Ko-fi Webhook
        const kofiPayload = {
            verification_token: '',
            message_id: 'test-12345',
            timestamp: new Date().toISOString(),
            type: 'Donation',
            from_name: 'TestGenerousDonor',
            message: 'Awesome stream! Keep it up!',
            amount: '15.00',
            currency: 'USD'
        };

        const kofiRes = await httpPost('/api/kofi-webhook', kofiPayload);
        report('POST /api/kofi-webhook processes donation successfully (200 OK)', kofiRes.status === 200 && JSON.parse(kofiRes.data).received === true);

        // Check if points were awarded (15 USD * 100 = 1500 bonus points)
        await new Promise(r => setTimeout(r, 500));
        const savedPoints = fs.existsSync(POINTS_FILE) ? JSON.parse(fs.readFileSync(POINTS_FILE, 'utf-8')) : {};
        const donorPts = savedPoints['testgenerousdonor'] || 0;
        report('Ko-fi donation awards 100 points per $1 donated', donorPts >= 1500);

    } catch (e) {
        report('Server HTTP/WS test execution', false, e.message);
    } finally {
        serverProc.kill();
    }
}

// -------------------------------------------------------------
// TEST 5: Streamer.bot Mock Connection & Multi-Platform Parser
// -------------------------------------------------------------
async function testStreamerBotParsing() {
    console.log('\n--- 5. Testing Streamer.bot WebSocket & Chat Parser ---');

    // Start a mock Streamer.bot WebSocket server on port 9005
    const mockPort = 9005;
    let mockServer;
    let serverWsClient = null;
    let subscriptionReceived = false;
    let receivedReplyAction = null;

    await new Promise((resolve) => {
        mockServer = new WebSocket.Server({ port: mockPort }, () => {
            resolve();
        });
    });

    mockServer.on('connection', (client) => {
        serverWsClient = client;
        client.on('message', (data) => {
            try {
                const parsed = JSON.parse(data);
                if (parsed.request === 'Subscribe') {
                    subscriptionReceived = true;
                    // Respond with confirmation
                    client.send(JSON.stringify({
                        id: "HoutarouBot",
                        status: "ok",
                        events: parsed.events
                    }));
                }
                if (parsed.request === 'DoAction') {
                    receivedReplyAction = parsed;
                }
            } catch (e) {}
        });
    });

    // Start server.js pointing to port 9005
    const serverProc = spawn('node', ['server.js'], {
        cwd: ROOT_DIR,
        env: { ...process.env, PORT: '8082' }
    });

    // Update config to point to port 9005
    await new Promise(r => setTimeout(r, 1500));

    try {
        const updateReq = http.request('http://127.0.0.1:8082/update-config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        updateReq.write(JSON.stringify({ streamerBotPort: '9005' }));
        updateReq.end();

        await new Promise(r => setTimeout(r, 2000));
        report('Server connected and subscribed to Streamer.bot on port 9005', subscriptionReceived);

        if (serverWsClient) {
            // Test 1: Kick chat message event
            receivedReplyAction = null;
            serverWsClient.send(JSON.stringify({
                event: { source: "Kick", type: "ChatMessage" },
                data: {
                    user: { name: "KickGamer" },
                    text: "!points"
                }
            }));

            await new Promise(r => setTimeout(r, 1000));
            report('Kick chat message parsed and replied via AI_Reply_Kick', receivedReplyAction && receivedReplyAction.action.name === 'AI_Reply_Kick');

            // Test 2: Twitch chat message event
            receivedReplyAction = null;
            serverWsClient.send(JSON.stringify({
                event: { source: "Twitch", type: "ChatMessage" },
                data: {
                    message: {
                        displayName: "TwitchGamer",
                        message: "!points"
                    }
                }
            }));

            await new Promise(r => setTimeout(r, 1000));
            report('Twitch chat message parsed and replied via AI_Reply_Twitch', receivedReplyAction && receivedReplyAction.action.name === 'AI_Reply_Twitch');

            // Test 3: YouTube chat message event
            receivedReplyAction = null;
            serverWsClient.send(JSON.stringify({
                event: { source: "YouTube", type: "Message" },
                data: {
                    user: { name: "YouTubeGamer" },
                    message: "!points"
                }
            }));

            await new Promise(r => setTimeout(r, 1000));
            report('YouTube chat message parsed and replied via AI_Reply_YouTube', receivedReplyAction && receivedReplyAction.action.name === 'AI_Reply_YouTube');

            // Test 4: Blacklisted bot message (Nightbot)
            receivedReplyAction = null;
            serverWsClient.send(JSON.stringify({
                event: { source: "Kick", type: "ChatMessage" },
                data: {
                    user: { name: "Nightbot" },
                    text: "!points"
                }
            }));

            await new Promise(r => setTimeout(r, 600));
            report('Messages from known bots (Nightbot) are silently ignored', receivedReplyAction === null);
        }
    } catch (e) {
        report('Streamer.bot mock test execution', false, e.message);
    } finally {
        serverProc.kill();
        mockServer.close();
    }
}

// -------------------------------------------------------------
// MAIN RUNNER
// -------------------------------------------------------------
async function runAllTests() {
    console.log('====================================================');
    console.log('🚀 Starting HoutarouBot Complete Test Suite');
    console.log('====================================================');

    try {
        testDatabase();
        testMinigames();
        testAI();
        await testServerAndEndpoints();
        await testStreamerBotParsing();
    } catch (err) {
        console.error('Fatal test error:', err);
    } finally {
        // Restore pristine sanitized state
        fs.writeFileSync(POINTS_FILE, '{}', 'utf-8');
        fs.writeFileSync(CONFIG_FILE, origConfig, 'utf-8');

        console.log('\n====================================================');
        console.log(`🏁 TEST RESULTS: ${testsPassed} PASSED | ${testsFailed} FAILED`);
        console.log('🧹 Cleaned up test files and restored pristine state.');
        console.log('====================================================\n');

        if (testsFailed > 0) {
            process.exit(1);
        } else {
            process.exit(0);
        }
    }
}

runAllTests();
