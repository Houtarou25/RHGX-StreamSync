const FALLBACK_MODELS = [
    "gemini-flash-latest",
    "gemini-3.5-flash-lite",
    "gemini-3.8-flash"
];

// Request queue to prevent concurrent burst requests hitting Google's rate limits
const requestQueue = [];
let isProcessingQueue = false;

async function processQueue() {
    if (isProcessingQueue || requestQueue.length === 0) return;
    isProcessingQueue = true;

    while (requestQueue.length > 0) {
        const item = requestQueue.shift();
        try {
            await item.fn();
        } catch (e) {
            console.error("❌ Queue execution error:", e.message);
        }
        // Small delay between requests to keep within Google's free-tier RPM limits
        if (requestQueue.length > 0) {
            await new Promise(r => setTimeout(r, 1200));
        }
    }

    isProcessingQueue = false;
}

module.exports = {
    generateResponse: function(config, platform, username, userMessage, replyCallback, retryCount = 0, onAlertCallback = null) {
        if (!config.apiKey) return console.log("❌ AI Error: No Gemini API Key set in Dashboard!");

        // Prevent queue backlog if spam occurs
        if (requestQueue.length >= 6) {
            return replyCallback(platform, `@${username} The AI queue is full right now, please try again in a few seconds!`);
        }

        requestQueue.push({
            fn: () => this.executeGeneration(config, platform, username, userMessage, replyCallback, retryCount, onAlertCallback, 0)
        });

        processQueue();
    },

    executeGeneration: async function(config, platform, username, userMessage, replyCallback, retryCount = 0, onAlertCallback = null, modelIndex = 0) {
        // Safely strip the trigger prefix regardless of casing
        let cleanMessage = userMessage;
        if (config.triggerPrefix && userMessage.toLowerCase().startsWith(config.triggerPrefix.toLowerCase())) {
            cleanMessage = userMessage.slice(config.triggerPrefix.length).trim();
        } else {
            cleanMessage = userMessage.trim();
        }

        // If the viewer just said "!bot" without text, give a friendly greeting prompt
        const userPrompt = cleanMessage || "Say hello and give a quick greeting!";
        
        const persona = (config.persona || "rude").toLowerCase();
        let behavior = "";
        if (persona === "custom") {
            behavior = "You are a custom AI assistant. Follow the extra knowledge rules strictly.";
        } else if (persona === "rude") {
            behavior = `You are a sarcastic, witty, and slightly rude AI assistant for the streamer ${config.channelName || 'Streamer'}. Roast the viewer gently.`;
        } else if (persona === "friendly") {
            behavior = `You are a highly energetic, positive, and friendly AI assistant for the streamer ${config.channelName || 'Streamer'}.`;
        } else if (persona === "gentle") {
            behavior = `You are a calm, soothing, and polite AI assistant for the streamer ${config.channelName || 'Streamer'}.`;
        } else {
            behavior = `You are an AI assistant for the streamer ${config.channelName || 'Streamer'}.`;
        }

        const links = config.links || {};
        const prompt = `${behavior} 
        Extra Rules & Knowledge: ${config.extraKnowledge || 'None'}
        If asked for links, use these: IG(${links.ig || 'N/A'}), YT(${links.yt || 'N/A'}), Discord(${links.discord || 'N/A'}), Kick(${links.kick || 'N/A'}), Twitch(${links.twitch || 'N/A'}), Ko-fi/Donation(${links.kofi || 'N/A'}).
        The viewer @${username} asked: "${userPrompt}". 
        Reply in 1 to 2 sentences maximum.`;

        // Select model with automatic fallback
        const modelName = (modelIndex === 0 && config.aiModel) ? config.aiModel : (FALLBACK_MODELS[modelIndex] || FALLBACK_MODELS[0]);

        // Support multiple API keys separated by comma
        const apiKeys = config.apiKey.split(',').map(k => k.trim()).filter(Boolean);
        const activeKey = apiKeys[retryCount % apiKeys.length] || apiKeys[0];

        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${activeKey}`;
            const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ 
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        maxOutputTokens: 75,
                        temperature: 0.8
                    }
                }),
                signal: AbortSignal.timeout(15000)
            });

            const data = await response.json();
            
            // Check for 404 model not found
            if (response.status === 404 || (data.error && data.error.code === 404)) {
                if (modelIndex + 1 < FALLBACK_MODELS.length) {
                    console.log(`⚠️ Model ${modelName} returned 404. Falling back to ${FALLBACK_MODELS[modelIndex + 1]}...`);
                    return this.executeGeneration(config, platform, username, userMessage, replyCallback, retryCount, onAlertCallback, modelIndex + 1);
                }
            }

            // Check for Google Rate Limit (429) or Server Overload (503)
            const isRateLimitOrOverload = response.status === 429 || response.status === 503 || 
                (data.error && (data.error.code === 429 || data.error.code === 503 || data.error.status === "RESOURCE_EXHAUSTED" || data.error.status === "UNAVAILABLE"));

            if (isRateLimitOrOverload) {
                console.log(`⚠️ Google API limit reached (${response.status}) on [${modelName}]: ${data.error?.message || 'Rate limit or overload'}`);
                
                // 1. Try alternate fallback model first
                if (modelIndex + 1 < FALLBACK_MODELS.length) {
                    console.log(`🔄 Trying alternate model: ${FALLBACK_MODELS[modelIndex + 1]}...`);
                    return this.executeGeneration(config, platform, username, userMessage, replyCallback, retryCount, onAlertCallback, modelIndex + 1);
                }

                // 2. If all models tried, apply backoff wait
                if (retryCount < 2) {
                    const waitSec = (retryCount + 1) * 3;
                    console.log(`⏳ Waiting ${waitSec}s for rate limit quota to reset... (Attempt ${retryCount + 1})`);
                    await new Promise(r => setTimeout(r, waitSec * 1000));
                    return this.executeGeneration(config, platform, username, userMessage, replyCallback, retryCount + 1, onAlertCallback, 0);
                } else {
                    console.log("❌ All models and retries exhausted.");
                    return replyCallback(platform, `@${username} [Rate Limited] My AI brain is on a short cooldown. Try again in 30 seconds!`);
                }
            }

            const aiReply = data.candidates?.[0]?.content?.parts?.[0]?.text;

            if (!aiReply) {
                console.log("\n❌ API ERROR (No candidate text):");
                console.log(JSON.stringify(data, null, 2));
                return replyCallback(platform, `@${username} [AI Processing Error]`);
            }

            const cleanReply = aiReply.trim();
            replyCallback(platform, `@${username} ${cleanReply}`);

            if (onAlertCallback) {
                onAlertCallback('ai_reply', {
                    username,
                    persona: config.persona || 'rude',
                    userMessage: cleanMessage,
                    reply: cleanReply,
                    platform
                });
            }
            
        } catch (error) {
            console.log(`❌ AI Request Failed on [${modelName}]:`, error.message);
            // If network/socket glitch or timeout, try next model once
            if (modelIndex + 1 < FALLBACK_MODELS.length) {
                console.log(`🔄 Retrying with fallback model: ${FALLBACK_MODELS[modelIndex + 1]}...`);
                await new Promise(r => setTimeout(r, 1000));
                return this.executeGeneration(config, platform, username, userMessage, replyCallback, retryCount, onAlertCallback, modelIndex + 1);
            }
        }
    },

    // Ultra-low token random chat chime-in (consumes ~40-60 tokens max)
    generateRandomChimeIn: function(config, platform, username, userMessage, replyCallback, onAlertCallback = null) {
        if (!config.apiKey) return;
        // If queue is busy with explicit user triggers, skip random chime-in to conserve quota
        if (requestQueue.length > 0) return;

        requestQueue.push({
            fn: () => this.executeRandomGeneration(config, platform, username, userMessage, replyCallback, onAlertCallback, 0)
        });

        processQueue();
    },

    executeRandomGeneration: async function(config, platform, username, userMessage, replyCallback, onAlertCallback = null, modelIndex = 0) {
        const persona = (config.persona || "friendly").toLowerCase();
        let attitude = "friendly and witty";
        if (persona === "rude") attitude = "slightly sarcastic and sassy";
        else if (persona === "gentle") attitude = "chill and polite";

        const prompt = `Live stream bot for ${config.channelName || 'the stream'}. Attitude: ${attitude}. Chat from @${username}: "${userMessage}". Give a short 1-sentence reaction under 12 words. No hashtags.`;

        const modelName = (modelIndex === 0 && config.aiModel) ? config.aiModel : (FALLBACK_MODELS[modelIndex] || FALLBACK_MODELS[0]);
        const apiKeys = config.apiKey.split(',').map(k => k.trim()).filter(Boolean);
        const activeKey = apiKeys[0] || '';

        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${activeKey}`;
            const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        maxOutputTokens: 25,
                        temperature: 0.7
                    }
                }),
                signal: AbortSignal.timeout(10000)
            });

            if (!response.ok) return; // Silent fail for random chime-in to avoid spamming errors

            const data = await response.json();
            const aiReply = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!aiReply) return;

            const cleanReply = aiReply.replace(/[\r\n]+/g, ' ').trim();
            replyCallback(platform, `@${username} ${cleanReply}`);

            if (onAlertCallback) {
                onAlertCallback('ai_reply', {
                    username,
                    persona: config.persona || 'friendly',
                    userMessage: userMessage,
                    reply: cleanReply,
                    platform
                });
            }
        } catch (e) {
            // Silently ignore random chime-in errors
        }
    }
};
