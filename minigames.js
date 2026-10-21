const db = require('./database');
let heistActive = false;
let heistParticipants = [];

function parseRedemptions(rawConfig) {
    const redemptions = {};
    if (!rawConfig || typeof rawConfig !== 'string') return redemptions;
    
    rawConfig.split(',').forEach(entry => {
        const item = entry.trim();
        if (!item) return;
        const parts = item.split(':').map(s => s.trim());
        const actionName = parts[0];
        const cost = parts.length > 1 ? Math.max(0, parseInt(parts[1], 10) || 0) : 0;
        if (actionName) {
            redemptions[actionName.toLowerCase()] = { name: actionName, cost };
        }
    });
    return redemptions;
}

function handleRedemption(actionKey, redemptions, platform, username, currentPoints, replyCallback, onAlertCallback, triggerActionCallback) {
    const item = redemptions[actionKey];
    if (!item) {
        return replyCallback(platform, `@${username}, redemption '${actionKey}' not found! Type !redeem to see options.`);
    }

    if (item.cost > 0 && currentPoints < item.cost) {
        return replyCallback(platform, `@${username}, you need ${item.cost} points for '${item.name}'. You have ${currentPoints} pts.`);
    }

    if (item.cost > 0) {
        db.updatePoints(username, -item.cost);
    }

    if (typeof triggerActionCallback === 'function') {
        triggerActionCallback(item.name, {
            user: username,
            platform: platform,
            cost: item.cost
        });
    }

    const remaining = db.getPoints(username);
    const costText = item.cost > 0 ? ` for ${item.cost} pts (${remaining} pts left)` : ``;
    replyCallback(platform, `🎉 @${username} redeemed [${item.name}]${costText}!`);

    if (onAlertCallback) {
        onAlertCallback('redemption', {
            username,
            action: item.name,
            cost: item.cost,
            platform,
            balance: remaining
        });
    }
}

module.exports = {
    processCommand: function(config, platform, username, command, args, replyCallback, onAlertCallback, triggerActionCallback = null) {
        const currentPoints = db.getPoints(username);
        const redemptions = parseRedemptions(config.actionRedemptions);

        // !setpoints [amount] [@user] OR !setpoints [@user] [amount]
        if (command === '!setpoints' && args.length >= 3) {
            let targetUser = null;
            let amount = NaN;

            if (!isNaN(parseInt(args[1]))) {
                amount = parseInt(args[1]);
                targetUser = args[2].replace('@', '');
            } else if (!isNaN(parseInt(args[2]))) {
                targetUser = args[1].replace('@', '');
                amount = parseInt(args[2]);
            }

            if (targetUser && !isNaN(amount)) {
                db.setPoints(targetUser, amount);
                return replyCallback(platform, `✅ Set ${targetUser}'s balance to ${amount} points.`);
            }
        }
        
        // !addpoints [amount] [@user] OR !addpoints [@user] [amount]
        if (command === '!addpoints' && args.length >= 3) {
            let targetUser = null;
            let amount = NaN;

            if (!isNaN(parseInt(args[1]))) {
                amount = parseInt(args[1]);
                targetUser = args[2].replace('@', '');
            } else if (!isNaN(parseInt(args[2]))) {
                targetUser = args[1].replace('@', '');
                amount = parseInt(args[2]);
            }

            if (targetUser && !isNaN(amount)) {
                db.updatePoints(targetUser, amount);
                return replyCallback(platform, `✅ Added ${amount} points to ${targetUser}. New balance: ${db.getPoints(targetUser)}.`);
            }
        }

        if (command === '!points') {
            return replyCallback(platform, `@${username}, you have ${currentPoints} points.`);
        }

        // !donate / !kofi donation link
        if (command === '!donate' || command === '!kofi' || command === '!donation') {
            const kofiUrl = config.links?.kofi || 'https://ko-fi.com';
            return replyCallback(platform, `☕ Support @${config.channelName || 'the stream'} on Ko-fi: ${kofiUrl}`);
        }

        // !redeem [action_name] or !redeem (list all)
        if (command === '!redeem' || command === '!redeems' || command === '!reward' || command === '!rewards') {
            if (!args[1]) {
                const keys = Object.keys(redemptions);
                if (keys.length === 0) {
                    return replyCallback(platform, `@${username}, no action redemptions are currently configured in the dashboard.`);
                }
                const list = keys.map(k => `${redemptions[k].name} (${redemptions[k].cost} pts)`).join(', ');
                return replyCallback(platform, `🔊 Available redemptions: ${list}. Use: !redeem <name>`);
            }

            const targetKey = args[1].toLowerCase().replace(/^!/, '');
            return handleRedemption(targetKey, redemptions, platform, username, currentPoints, replyCallback, onAlertCallback, triggerActionCallback);
        }

        // Direct shorthand redemption: e.g. !sus, !wow, !ara
        const shorthandKey = command.replace(/^!/, '').toLowerCase();
        if (redemptions[shorthandKey]) {
            return handleRedemption(shorthandKey, redemptions, platform, username, currentPoints, replyCallback, onAlertCallback, triggerActionCallback);
        }

        if (command === '!gamble') {
            let bet = args[1] === 'all' ? currentPoints : parseInt(args[1]);
            
            if (isNaN(bet) || bet <= 0 || bet < config.gambleMin) return replyCallback(platform, `@${username}, minimum gamble is ${config.gambleMin}.`);
            if (bet > config.gambleMax) return replyCallback(platform, `@${username}, maximum gamble is ${config.gambleMax}.`);
            if (bet > currentPoints) return replyCallback(platform, `@${username}, you only have ${currentPoints} points.`);

            const roll = Math.floor(Math.random() * 100) + 1; 
            db.updatePoints(username, -bet); 

            let winnings = 0;
            if (roll >= 99) winnings = Math.round(bet * config.gambleMul5);
            else if (roll >= 76) winnings = Math.round(bet * config.gambleMul4);
            else if (roll >= 51) winnings = Math.round(bet * config.gambleMul3);
            else if (roll >= 26) winnings = Math.round(bet * config.gambleMul2);
            else winnings = Math.round(bet * config.gambleMul1);

            if (winnings > 0) {
                db.updatePoints(username, winnings);
                const reply = `🎰 @${username} rolled ${roll} and WON ${winnings} pts! 🎉 Balance: ${db.getPoints(username)}.`;
                replyCallback(platform, reply);
                if (onAlertCallback) onAlertCallback('gamble', { username, roll, won: true, amount: winnings, balance: db.getPoints(username) });
            } else {
                const reply = `🎰 @${username} rolled ${roll} and LOST! 💀 Balance: ${db.getPoints(username)}.`;
                replyCallback(platform, reply);
                if (onAlertCallback) onAlertCallback('gamble', { username, roll, won: false, amount: bet, balance: db.getPoints(username) });
            }
        }

        if (command === '!heist') {
            let bet = args[1] === 'all' ? currentPoints : parseInt(args[1]);
            
            if (isNaN(bet) || bet <= 0 || bet < config.heistMin) return replyCallback(platform, `@${username}, min heist bet is ${config.heistMin}.`);
            if (bet > config.heistMax) return replyCallback(platform, `@${username}, max heist bet is ${config.heistMax}.`);
            if (bet > currentPoints) return replyCallback(platform, `@${username}, you can't afford that.`);
            if (heistParticipants.find(p => p.username.toLowerCase() === username.toLowerCase())) return replyCallback(platform, `@${username}, you are already in!`);

            db.updatePoints(username, -bet);
            heistParticipants.push({ username, bet, platform });

            if (!heistActive) {
                heistActive = true;
                const startMsg = `🚨 @${username} started a HEIST! Type !heist [amount] to join! Van leaves in ${config.heistTime}s!`;
                replyCallback(platform, startMsg);
                if (onAlertCallback) onAlertCallback('heist_start', { leader: username, countdown: config.heistTime });

                setTimeout(() => {
                    heistActive = false; 
                    const totalCrew = heistParticipants.length;
                    const winChance = (config.heistChance / 100) + (totalCrew * 0.05); 
                    const roll = Math.random();
                    const crewNames = heistParticipants.map(p => `@${p.username}`).join(', ');

                    if (roll <= winChance) {
                        heistParticipants.forEach(p => db.updatePoints(p.username, p.bet * 2));
                        const winMsg = `💰 HEIST SUCCESS! The crew (${crewNames}) doubled their money!`;
                        replyCallback(platform, winMsg);
                        if (onAlertCallback) onAlertCallback('heist_result', { success: true, crew: crewNames });
                    } else {
                        const bustMsg = `🚓 BUSTED! The cops caught (${crewNames}). All points lost!`;
                        replyCallback(platform, bustMsg);
                        if (onAlertCallback) onAlertCallback('heist_result', { success: false, crew: crewNames });
                    }
                    heistParticipants = []; 
                }, config.heistTime * 1000);
            } else {
                replyCallback(platform, `🕶️ @${username} jumped into the heist van!`);
                if (onAlertCallback) onAlertCallback('heist_join', { username, crewCount: heistParticipants.length });
            }
        }
    }
};
