
import 'dotenv/config';
import express from 'express';
import { createClient } from '@tursodatabase/serverless/compat';

import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const PORT = process.env.PORT || 3000;
const SHARED_SECRET = process.env.ESP32_SHARED_SECRET;
const EXPECTED_DEVICE_ID = process.env.EXPECTED_DEVICE_ID;

const app = express();

app.set('view engine', 'ejs');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

app.use(express.static('public'));

const db = createClient({
    url: process.env.TURSO_URL,
    authToken: process.env.TURSO_TOKEN
});

const HIGH_ALERT = 25;
const LOW_ALERT = 10;

let current = 20;
let low = current;
let data = [];
let latestUpdate = new Date(0);

function getCurrentHour() {
    const date = new Date();
    date.setMinutes(0, 0, 0);
    return date;
}

function updateLow() {
    low = current;

    for (const row of data) {
        const temperature = Number(row.temperature);

        if (Number.isFinite(temperature) && temperature < low) {
            low = temperature;
        }
    }
}

async function initializeDatabase() {
    await db.execute(`
        CREATE TABLE IF NOT EXISTS data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp INTEGER,
            temperature INTEGER
        )
    `);

    await db.execute(`
        DELETE FROM data
        WHERE id NOT IN (
            SELECT MIN(id)
            FROM data
            GROUP BY timestamp
        )
    `);

    await db.execute(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_data_timestamp
        ON data(timestamp)
    `);

    const result = await db.execute(`
        SELECT MAX(timestamp) AS latestTimestamp
        FROM data
    `);

    const timestamp = result.rows[0].latestTimestamp;

    if (timestamp !== null) {
        latestUpdate = new Date(Number(timestamp) * 1000);
    } else {
        latestUpdate = new Date(0);
    }

    console.log('Connected to Turso database');

    await getLast24Hours();
}

function verifyESP32(req, res, next) {
    const deviceId = req.get('X-Device-ID');
    const secret = req.get('X-ESP32-Secret');

    if (
        deviceId === EXPECTED_DEVICE_ID &&
        secret === SHARED_SECRET
    ) {
        req.deviceId = deviceId;
        return next();
    }

    console.log('Unauthorized request was denied');

    return res.status(403).json({
        error: 'Unauthorized device'
    });
}

app.get('/', (req, res) => {
    console.log("Current: " + current);
    console.log("Low: " + low);
    console.log(data);
    res.render('main', {
        temperature: current,
        low: low,
        data: data
    });
});

app.get('/current', (req, res) => {
    res.send({ temperature: current });
});

app.get('/past24', async (req, res) => {
    try {
        const rows = await getLast24Hours();
        res.send(rows);
    } catch (err) {
        console.error('Failed to retrieve past 24 hours:', err.message);
        res.status(500).send('Database error');
    }
});

app.get('/temperature', verifyESP32, handleTemperature);

app.get('/backdoor', handleTemperature);

async function handleTemperature(req, res) {
    const rawTemperature = req.query.temperature;
    const temperature = Number(rawTemperature);

    if (
        rawTemperature === undefined ||
        rawTemperature.trim() === '' ||
        !Number.isFinite(temperature)
    ) {
        return res.status(400).send('Invalid temperature');
    }

    current = temperature;

    if (temperature > HIGH_ALERT) {
        console.log('ALERT: HIGH TEMPERATURE...');
    }

    if (temperature < LOW_ALERT) {
        console.log('ALERT: LOW TEMPERATURE...');
    }

    const date = getCurrentHour();
    const timestamp = Math.floor(date.getTime() / 1000);

    if (date > latestUpdate) {
        try {
            const result = await db.execute({
                sql: `
                    INSERT OR IGNORE INTO data (timestamp, temperature)
                    VALUES (?, ?)
                `,
                args: [timestamp, temperature]
            });

            if (Number(result.rowsAffected) > 0) {
                console.log('Successfully pushed data to database');
            } else {
                console.log('A record for this hour already exists');
            }

            latestUpdate = date;

            await getLast24Hours();
        } catch (err) {
            console.error('Failed to save temperature:', err.message);
            return res.status(500).send('Database error');
        }
    } else {
        updateLow();
    }

    res.sendStatus(200);
}

async function getLast24Hours() {
    const date = new Date();
    date.setHours(date.getHours() - 23);
    date.setMinutes(0, 0, 0);

    const cutoff = Math.floor(date.getTime() / 1000);

    const result = await db.execute({
        sql: `
            SELECT *
            FROM data
            WHERE timestamp >= ?
            ORDER BY timestamp ASC
        `,
        args: [cutoff]
    });

    data = result.rows.map(row => ({
        id: row[0],
        timestamp: row[1],
        temperature: row[2]
    }));

    updateLow();

    console.log(`Retrieved ${data.length} data rows`);

    return data;
}

async function populate() {
    const now = new Date();
    const date = new Date(now);

    date.setDate(date.getDate() - 7);
    date.setMinutes(0, 0, 0);

    const query = `
        INSERT OR IGNORE INTO data (timestamp, temperature)
        VALUES (?, ?)
    `;

    while (date <= now) {
        const temp = Math.round(20 + Math.random() * 2 - 1);

        const result = await db.execute({
            sql: query,
            args: [
                Math.floor(date.getTime() / 1000),
                temp
            ]
        });

        if (Number(result.rowsAffected) > 0) {
            console.log('Successfully inserted sample data');
        }

        date.setHours(date.getHours() + 1);
    }

    await refreshLatestUpdate();
    await getLast24Hours();
}

async function refreshLatestUpdate() {
    const result = await db.execute(`
        SELECT MAX(timestamp) AS latestTimestamp
        FROM data
    `);

    const timestamp = result.rows[0].latestTimestamp;

    latestUpdate = timestamp !== null
        ? new Date(Number(timestamp) * 1000)
        : new Date(0);
}

async function deleteAll() {
    await db.execute('DELETE FROM data');

    latestUpdate = new Date(0);
    data = [];
    updateLow();

    console.log('Successfully deleted all data');
}

app.get('/populate', async (req, res) => {
    try {
        await populate();
        res.send('Successfully populated database');
    } catch (err) {
        console.error('Failed to populate database:', err.message);
        res.status(500).send('Failed to populate database');
    }
});

app.get('/delete/table', async (req, res) => {
    try {
        await deleteAll();
        res.send('Successfully deleted all data');
    } catch (err) {
        console.error('Failed to delete data:', err.message);
        res.status(500).send('Failed to delete data');
    }
});

try {
    await initializeDatabase();

    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Server listening on port ${PORT}`);
    });
} catch (err) {
    console.error('Server initialization failed:', err);
    process.exit(1);
}
