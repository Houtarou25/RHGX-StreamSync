// 🏆 IN-MEMORY DATABASE WITH JSON PERSISTENCE
const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'points.json');
let viewerPoints = {}; 

try {
    if (fs.existsSync(DB_FILE)) {
        viewerPoints = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
    }
} catch (e) {
    console.error("⚠️ Error loading points.json, initializing empty DB:", e.message);
}

function saveDB() {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(viewerPoints, null, 2), 'utf-8');
    } catch (e) {
        console.error("⚠️ Error saving points.json:", e.message);
    }
}

module.exports = {
    getPoints: function(username) {
        if (!username) return 100;
        const key = username.toLowerCase();
        if (viewerPoints[key] === undefined) {
            viewerPoints[key] = 100;
            saveDB();
        }
        return viewerPoints[key];
    },
    updatePoints: function(username, amount) {
        if (!username) return 0;
        const key = username.toLowerCase();
        viewerPoints[key] = this.getPoints(key) + amount;
        saveDB();
        return viewerPoints[key];
    },
    setPoints: function(username, amount) {
        if (!username) return 0;
        const key = username.toLowerCase();
        viewerPoints[key] = amount;
        saveDB();
        return viewerPoints[key];
    },
    resetAllPoints: function() {
        viewerPoints = {}; // Wipes the entire database
        saveDB();
        console.log("⚠️ ALL VIEWER POINTS HAVE BEEN RESET TO 0.");
    },
    getLeaderboard: function(limit = 50) {
        return Object.entries(viewerPoints)
            .map(([username, points]) => ({
                username,
                points: Number(points) || 0
            }))
            .sort((a, b) => b.points - a.points)
            .slice(0, limit);
    },
    getStats: function() {
        const users = Object.keys(viewerPoints);
        const totalPoints = Object.values(viewerPoints).reduce((sum, pts) => sum + (Number(pts) || 0), 0);
        return {
            totalUsers: users.length,
            totalPoints: totalPoints
        };
    }
};
