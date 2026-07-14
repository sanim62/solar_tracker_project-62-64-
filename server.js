const express = require('express');
const { WebSocketServer } = require('ws');
const mysql = require('mysql2/promise');
const fetch = require('node-fetch');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());

// Session setup
app.use(session({
    secret: process.env.ADMIN_SECRET || 'solar_tracker_secret_fallback',
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 24 // 24 hours
    }
}));

// Configure Database Connection Pool
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    database: process.env.DB_NAME || 'solar_tracker',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || ''
};

let db;

async function initDb() {
    try {
        db = await mysql.createPool(dbConfig);
        console.log('Connected to MySQL database successfully.');
    } catch (err) {
        console.error('Failed to connect to MySQL database:', err.message);
        process.exit(1);
    }
}

// Security Middleware to require Admin role
function requireAdmin(req, res, next) {
    if (req.session.user && req.session.user.role === 'admin') {
        return next();
    }
    res.status(403).json({ error: 'Forbidden: Admin access required' });
}

// Route to protect access to admin.html and redirect if unauthorized
app.get('/admin.html', (req, res) => {
    if (req.session.user && req.session.user.role === 'admin') {
        res.sendFile(path.join(__dirname, 'public', 'admin.html'));
    } else {
        res.redirect('/login.html');
    }
});

// Cache map to store device_id to user_id mapping
const deviceUserCache = {};

async function getUserIdForDevice(deviceId) {
    if (deviceUserCache[deviceId] !== undefined) {
        return deviceUserCache[deviceId];
    }
    try {
        const [rows] = await db.execute('SELECT id FROM users WHERE device_id = ? LIMIT 1', [deviceId]);
        if (rows.length > 0) {
            deviceUserCache[deviceId] = rows[0].id;
            return rows[0].id;
        }
    } catch (err) {
        console.error('Error fetching user_id for device:', err.message);
    }
    deviceUserCache[deviceId] = null;
    return null;
}

// In-memory tracker for last insert timestamp per device (to prevent duplicate writes)
const lastInsertTime = {};

// WebSocket Server
const wsPort = parseInt(process.env.WS_PORT || '8080');
const wss = new WebSocketServer({ port: wsPort });
console.log(`WebSocket Server listening on port ${wsPort}`);

function broadcast(data) {
    const msg = JSON.stringify({ type: 'reading', data });
    wss.clients.forEach(c => {
        if (c.readyState === 1) { // 1 = OPEN
            c.send(msg);
        }
    });
}

// Blynk Polling Configuration
const BLYNK_TOKEN = process.env.BLYNK_TOKEN || 'CHDVXJCB7iVixAtAXsoaScjUG6KCl0ei';
const BLYNK_SERVER = process.env.BLYNK_SERVER || 'https://blynk.cloud/external/api';
const BLYNK_URL = `${BLYNK_SERVER}/get?token=${BLYNK_TOKEN}&v1&v2&v3&v4&v5&v6&v7&v8&v9`;

async function fetchBlynkPin(pin) {
    try {
        const resp = await fetch(`${BLYNK_SERVER}/get?token=${BLYNK_TOKEN}&${pin}`);
        if (!resp.ok) return null;
        const text = await resp.text();
        try {
            const parsed = JSON.parse(text);
            if (Array.isArray(parsed)) return parseFloat(parsed[0]);
            if (typeof parsed === 'object' && parsed !== null) {
                const key = Object.keys(parsed).find(k => k.toLowerCase() === pin.toLowerCase());
                return key ? parseFloat(parsed[key]) : null;
            }
            return parseFloat(parsed);
        } catch {
            return parseFloat(text);
        }
    } catch {
        return null;
    }
}

async function fetchTelemetryFromBlynk() {
    try {
        const resp = await fetch(BLYNK_URL);
        if (resp.ok) {
            const data = await resp.json();
            return {
                v1: data.v1 ?? data.V1,
                v2: data.v2 ?? data.V2,
                v3: data.v3 ?? data.V3,
                v4: data.v4 ?? data.V4,
                v5: data.v5 ?? data.V5,
                v6: data.v6 ?? data.V6,
                v7: data.v7 ?? data.V7,
                v8: data.v8 ?? data.V8,
                v9: data.v9 ?? data.V9
            };
        }
    } catch (err) {
        // Fall back silently to individual fetches
    }

    const [v1, v2, v3, v4, v5, v6, v7, v8, v9] = await Promise.all([
        fetchBlynkPin('v1'),
        fetchBlynkPin('v2'),
        fetchBlynkPin('v3'),
        fetchBlynkPin('v4'),
        fetchBlynkPin('v5'),
        fetchBlynkPin('v6'),
        fetchBlynkPin('v7'),
        fetchBlynkPin('v8'),
        fetchBlynkPin('v9')
    ]);

    return { v1, v2, v3, v4, v5, v6, v7, v8, v9 };
}

// Start polling Blynk every 1 second
setInterval(async () => {
    if (!db) return; // Wait for database connection

    const raw = await fetchTelemetryFromBlynk();
    
    // Default device ID matches sketch
    const deviceId = '2207062';

    // Duplicate check: skip if last insert was less than 800ms ago
    const now = Date.now();
    if (lastInsertTime[deviceId] && (now - lastInsertTime[deviceId] < 800)) {
        return;
    }

    const voltage = parseFloat(raw.v1 ?? 0);
    const current = parseFloat(raw.v2 ?? 0);
    
    // If Blynk datastream is missing power, calculate V * A
    let power = parseFloat(raw.v3 ?? (voltage * current));
    if (isNaN(power)) power = 0;

    const pan = parseInt(raw.v4 ?? 90);
    const tilt = parseInt(raw.v5 ?? 90);

    const row = {
        device_id: deviceId,
        voltage: voltage,
        current_a: current,
        power: power,
        pan_angle: isNaN(pan) ? 90 : pan,
        tilt_angle: isNaN(tilt) ? 90 : tilt,
        ldr_tl: parseInt(raw.v6 ?? 0),
        ldr_tr: parseInt(raw.v7 ?? 0),
        ldr_bl: parseInt(raw.v8 ?? 0),
        ldr_br: parseInt(raw.v9 ?? 0),
        efficiency: Math.round(power * 10) / 10 // Max capacity is 100W, so efficiency % = power
    };

    // Save to DB
    try {
        const userId = await getUserIdForDevice(deviceId);
        await db.execute(
            `INSERT INTO tracker_readings 
             (device_id, user_id, voltage, current_a, power, pan_angle, tilt_angle, ldr_tl, ldr_tr, ldr_bl, ldr_br, efficiency)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                row.device_id,
                userId,
                row.voltage,
                row.current_a,
                row.power,
                row.pan_angle,
                row.tilt_angle,
                row.ldr_tl,
                row.ldr_tr,
                row.ldr_bl,
                row.ldr_br,
                row.efficiency
            ]
        );
        lastInsertTime[deviceId] = now;
    } catch (err) {
        console.error('Error inserting reading into DB:', err.message);
    }

    // Broadcast update via WebSocket
    broadcast(row);
}, 1000);

// API Endpoints

// Authentication API
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
    }
    try {
        const [rows] = await db.execute('SELECT * FROM users WHERE email = ?', [email]);
        if (rows.length === 0) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        const user = rows[0];
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        req.session.user = {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            device_id: user.device_id
        };
        res.json({ success: true, user: req.session.user });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            return res.status(500).json({ error: 'Failed to destroy session' });
        }
        res.json({ success: true });
    });
});

app.get('/api/session', (req, res) => {
    if (req.session.user) {
        res.json({ loggedIn: true, user: req.session.user });
    } else {
        res.json({ loggedIn: false });
    }
});

// Telemetry History
app.get('/api/history', async (req, res) => {
    const deviceId = req.query.device_id || '2207062';
    const hours = parseInt(req.query.hours || '24');
    try {
        const [rows] = await db.execute(
            `SELECT * FROM tracker_readings 
             WHERE device_id = ? AND recorded_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)
             ORDER BY recorded_at ASC`,
            [deviceId, hours]
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Alerts API
app.post('/api/alerts', async (req, res) => {
    const { device_id, level, message } = req.body;
    if (!device_id || !message) {
        return res.status(400).json({ error: 'device_id and message are required' });
    }
    const userId = await getUserIdForDevice(device_id);
    try {
        await db.execute(
            `INSERT INTO alert_log (device_id, user_id, level, message) VALUES (?, ?, ?, ?)`,
            [device_id, userId, level || 'info', message]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/alerts', requireAdmin, async (req, res) => {
    const deviceId = req.query.device_id || '2207062';
    const limit = parseInt(req.query.limit || '50');
    try {
        const [rows] = await db.execute(
            `SELECT * FROM alert_log WHERE device_id = ? ORDER BY created_at DESC LIMIT ?`,
            [deviceId, limit]
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Admin Panel APIs
app.get('/api/admin/devices', requireAdmin, async (req, res) => {
    try {
        const query = `
            SELECT u.id as user_id, u.name as user_name, u.email as user_email, u.device_id,
                   r.voltage, r.current_a, r.power, r.pan_angle, r.tilt_angle, r.recorded_at as last_seen
            FROM users u
            LEFT JOIN (
                SELECT r1.* FROM tracker_readings r1
                INNER JOIN (
                    SELECT device_id, MAX(recorded_at) as max_time
                    FROM tracker_readings
                    GROUP BY device_id
                ) r2 ON r1.device_id = r2.device_id AND r1.recorded_at = r2.max_time
            ) r ON u.device_id = r.device_id
            ORDER BY u.id ASC
        `;
        const [rows] = await db.execute(query);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/readings', requireAdmin, async (req, res) => {
    const deviceId = req.query.device_id;
    if (!deviceId) {
        return res.status(400).json({ error: 'device_id parameter is required' });
    }
    const limit = parseInt(req.query.limit || '500');
    try {
        const [rows] = await db.execute(
            `SELECT * FROM tracker_readings WHERE device_id = ? ORDER BY recorded_at DESC LIMIT ?`,
            [deviceId, limit]
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/export', requireAdmin, async (req, res) => {
    const deviceId = req.query.device_id;
    if (!deviceId) {
        return res.status(400).json({ error: 'device_id parameter is required' });
    }
    try {
        const [rows] = await db.execute(
            `SELECT recorded_at, voltage, current_a, power, pan_angle, tilt_angle,
                    ldr_tl, ldr_tr, ldr_bl, ldr_br, efficiency
             FROM tracker_readings WHERE device_id = ? ORDER BY recorded_at DESC LIMIT 10000`,
            [deviceId]
        );
        const header = 'recorded_at,voltage,current_a,power,pan_angle,tilt_angle,ldr_tl,ldr_tr,ldr_bl,ldr_br,efficiency\n';
        const csv = header + rows.map(r => {
            const formattedDate = new Date(r.recorded_at).toISOString();
            return [
                formattedDate,
                r.voltage,
                r.current_a,
                r.power,
                r.pan_angle,
                r.tilt_angle,
                r.ldr_tl,
                r.ldr_tr,
                r.ldr_bl,
                r.ldr_br,
                r.efficiency
            ].join(',');
        }).join('\n');
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="tracker_${deviceId}.csv"`);
        res.send(csv);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Serve Static Frontend Assets (mounted after specific protected page checks)
app.use(express.static(path.join(__dirname, 'public')));

// Fallback all unspecified page routes to index.html (SPA routing support)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
const httpPort = parseInt(process.env.HTTP_PORT || '3000');
initDb().then(() => {
    app.listen(httpPort, () => {
        console.log(`HTTP Server listening on port ${httpPort}`);
    });
});
