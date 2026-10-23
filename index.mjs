import express from 'express';
import sqlite3 from 'sqlite3';

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PORT = process.env.PORT || 3000;
const SHARED_SECRET = process.env.ESP32_SHARED_SECRET;
const EXPECTED_DEVICE_ID = process.env.EXPECTED_DEVICE_ID;

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

app.use(express.static('public'));

// Connect to database file (creates it if it doesn't exist)
const db = new sqlite3.Database('./database.db', (err) => {
    if (err) return console.error(err.message);
    console.log('Connected to the SQLite database.');
});

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS datapoint (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER,
        temperature INTEGER
    )`);
});

let high = 25;
let low = 20;

function verifyESP32(req, res, next) {
    console.log("Authenticating request");
    const deviceId = req.get('X-Device-ID');
    const secret = req.get('X-ESP32-Secret');

    if (deviceId === EXPECTED_DEVICE_ID && secret === SHARED_SECRET) {
        req.deviceId = deviceId;
        console.log("Authenticated request : ESP32");
        return next();
    }
    else {
        console.log("Unauthorized request was denied");
    }

    return res.status(403).json({ error: 'Unauthorized device' });
}

app.get('/', (req, res) => {
    res.sendFile(join(__dirname, 'public', 'main.html'));
});

app.get('/temperature', verifyESP32, (req, res) => {
    const temperature = req.query.temperature;

    if(temperature > high) console.log("ALERT: HIGH TEMPERATURE...");
    if(temperature < low) console.log("ALERT: LOW TEMPERATURE...");

    // Insert Data in database
    const insert = `INSERT INTO datapoint (timestamp, temperature) VALUES (?, ?)`;
    db.run(insert, [Date.now() / 1000, 22], function(err) {
        if (err) return console.error(err.message);
        console.log("Temperature: " + temperature + "°C");
    });

    res.sendStatus(200);
});

app.get('/testbackdoor', (req, res) => {
    console.log("ALERT: Backdoor used");

    const temperature = req.query.temperature;

    if(temperature > high) console.log("ALERT: HIGH TEMPERATURE...");

    // Insert Data in database
    const insert = `INSERT INTO datapoint (timestamp, temperature) VALUES (?, ?)`;
    db.run(insert, [Date.now() / 1000, 22], function(err) {
        if (err) return console.error(err.message);
        console.log("Temperature: " + temperature + "°C");
    });

    res.send(200);
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0:${PORT}`);
});