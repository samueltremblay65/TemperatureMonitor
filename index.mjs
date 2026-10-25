import express from 'express';
import sqlite3 from 'sqlite3';

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PORT = process.env.PORT || 3000;
const SHARED_SECRET = process.env.ESP32_SHARED_SECRET;
const EXPECTED_DEVICE_ID = process.env.EXPECTED_DEVICE_ID;

const app = express();

app.set('view engine', 'ejs');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

app.use(express.static('public'));

// Connect to database file (creates it if it doesn't exist)
const db = new sqlite3.Database('./database.db', (err) => {
    if (err) return console.error(err.message);
    console.log('Connected to the SQLite database.');
});

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS data (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER,
        temperature INTEGER
    )`);
});

let high = 25;
let low = 10;

let current = 20;
let data;

let latestUpdate;

getLast24Hours();

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
    console.log(data);
    res.render('main', {temperature: current, data:data});
});

app.get('/current', (req, res) => {
    res.send({temperature: current});
});

app.get('/temperature', verifyESP32, (req, res) => {
    const temperature = req.query.temperature;

    current = temperature;

    if(temperature > high) console.log("ALERT: HIGH TEMPERATURE...");
    if(temperature < low) console.log("ALERT: LOW TEMPERATURE...");

    const date = new Date();
    date.setMinutes(0,0,0);

    if(date > latestUpdate) {
        const insert = `INSERT INTO data (timestamp, temperature) VALUES (?, ?)`;
        db.run(insert, [Math.round(date.getTime() / 1000), 22], function(err) {
            if (err){
                return console.error(err.message);
            } 
            console.log("Successfully pushed data to database");
            latestUpdate = date;
        });
    }

    res.sendStatus(200);
});

function getLast24Hours() {
    let date = new Date();
    date.setDate(date.getDate() - 1);
    date.setMinutes(0, 0, 0);
    const ms = date.getTime();
    const query = `SELECT * FROM data WHERE timestamp >= ?`;
    db.all(query, [Math.round(ms / 1000)], (err, rows) => {
        if (err) {
            return console.error(err.message);;
        }
        data = rows;
        console.log("Retrieved " + data.length + " data rows");
    });
}

function populate() {
    let date = new Date();
    let now = new Date();

    let lastTemp = 20;

    date.setDate(date.getDate() - 7);
    date.setMinutes(0, 0, 0);

    const query = `INSERT INTO data (timestamp, temperature) VALUES (?, ?)`;

    while(date <= now) {
        let temp = Math.round(lastTemp + Math.random() * 2 - 1);
        db.run(query, [Math.round(date.getTime() / 1000), temp], function(err) {
            if (err) return console.error(err.message);
            console.log("Successfully pushed data to database");
        });
        date.setHours(date.getHours() + 1);
    }
}

function deleteAll() {
    const query = `DELETE FROM data`;
    db.run(query, function(err) {
        if (err) return console.error(err.message);
        console.log("Successfully deleted data table");
    });
}

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0:${PORT}`);
});