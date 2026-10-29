
import 'dotenv/config';
import express from 'express';
import { createClient } from '@tursodatabase/serverless/compat';
import cors from 'cors';

import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const PORT = process.env.PORT || 3000;
const SHARED_SECRET = process.env.ESP32_SHARED_SECRET;
const EXPECTED_DEVICE_ID = process.env.EXPECTED_DEVICE_ID;
const DEBUG = process.env.DEBUG === 'true'

const app = express();

app.use(cors({
    origin: [
        'http://localhost:3000',
        'https://temperaturemonitor.onrender.com/'
    ]
}));

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

let current;
let low;
let high;
let hourlyData = [];
let dailyData = [];
let latestUpdate = new Date(0);

function getCurrentHour() {
    const date = new Date();
    date.setMinutes(0, 0, 0);
    return date;
}

function updateExtremes() {
    low = current;
    high = current;

    for (const row of hourlyData) {
        const temperature = Number(row.temperature);

        if (Number.isFinite(temperature) && temperature < low) {
            low = temperature;
        }

        if (Number.isFinite(temperature) && temperature > high) {
            high = temperature;
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
        CREATE TABLE IF NOT EXISTS daily_reports (
            timestamp INTEGER PRIMARY KEY,
            min_temperature INTEGER,
            max_temperature INTEGER,
            avg_temperature REAL,
            reading_count INTEGER
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

    await getHourlyData();
    await getDailyData();
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
    res.render('main', {
        debug: DEBUG,
        temperature: current,
        high, high,
        low: low,
        hourlyData: hourlyData,
        dailyData: dailyData
    });
});

app.get('/current', (req, res) => {
    res.send({ temperature: current });
});

app.get('/hourly', async (req, res) => {
    try {
        const rows = await getHourlyData();
        res.send(rows);
    } catch (err) {
        console.error('Failed to retrieve hourly data:', err.message);
        res.status(500).send('Database error');
    }
});

app.get('/daily', async (req, res) => {
    try {
        const rows = await getDailyData();
        res.send(rows);
    } catch (err) {
        console.error('Failed to retrieve daily data', err.message);
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
        const previousDate = new Date(latestUpdate);

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
                await getHourlyData();

                if (
                    latestUpdate.getTime() > 0 &&
                    previousDate.toDateString() !== date.toDateString()
                ) {
                    await generateDailyReport(previousDate);
                }
            } else {
                console.log('A record for this hour already exists');
            }

            latestUpdate = date;
        } catch (err) {
            console.error('Failed to save temperature:', err.message);
            return res.status(500).send('Database error');
        }
    } else {
        updateExtremes();
    }

    res.sendStatus(200);
}

async function generateDailyReport(date) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);

    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    const startTimestamp = Math.floor(start.getTime() / 1000);
    const endTimestamp = Math.floor(end.getTime() / 1000);

    const result = await db.execute({
        sql: `
            SELECT
                MIN(temperature),
                MAX(temperature),
                AVG(temperature),
                COUNT(*)
            FROM data
            WHERE timestamp >= ?
              AND timestamp < ?
        `,
        args: [startTimestamp, endTimestamp]
    });

    const row = result.rows[0];

    if (Number(row[3]) === 0) return;

    await db.execute({
        sql: `
            INSERT OR IGNORE INTO daily_reports (
                timestamp,
                min_temperature,
                max_temperature,
                avg_temperature,
                reading_count
            )
            VALUES (?, ?, ?, ?, ?)
        `,
        args: [
            startTimestamp,
            row[0],
            row[1],
            row[2],
            row[3]
        ]
    });

    console.log(`Generated daily report for ${start.toDateString()}`);
}

async function getHourlyData() {
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

    hourlyData = result.rows.map(row => ({
        id: row[0],
        timestamp: row[1],
        temperature: row[2]
    }));

    updateExtremes();

    console.log(`Retrieved ${hourlyData.length} data rows`);
    return hourlyData;
}

async function getDailyData() {
    const cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - 29);

    const timestamp = Math.floor(cutoff.getTime() / 1000);

    const result = await db.execute({
        sql: `
            SELECT timestamp, min_temperature, max_temperature,
                   avg_temperature, reading_count
            FROM daily_reports
            WHERE timestamp >= ?
            ORDER BY timestamp ASC
        `,
        args: [timestamp]
    });

    dailyData = result.rows.map(row => ({
        timestamp: Number(row.timestamp),
        min_temperature: Number(row.min_temperature),
        max_temperature: Number(row.max_temperature),
        avg_temperature: Number(row.avg_temperature),
    }));
}

async function fillDailyData() {
    // Find the first and last timestamps in the hourly data.
    const rangeResult = await db.execute(`
        SELECT MIN(timestamp), MAX(timestamp)
        FROM data
    `);

    const firstTimestamp = rangeResult.rows[0][0];

    const yesterday = new Date();
    yesterday.setHours(0, 0, 0, 0);
    yesterday.setDate(yesterday.getDate() - 1);

    const lastTimestamp = Math.floor(yesterday.getTime() / 1000);

    if (firstTimestamp == null || lastTimestamp == null) {
        console.log('No hourly data to process');
        return;
    }

    // Get all days that already have daily reports.
    const reportsResult = await db.execute(`
        SELECT timestamp
        FROM daily_reports
    `);

    const existingDays = new Set(
        reportsResult.rows.map(row => Number(row[0]))
    );

    // Find the first and last local calendar days containing data.
    const firstDate = new Date(Number(firstTimestamp) * 1000);
    firstDate.setHours(0, 0, 0, 0);

    console.log("Filling daily data: first date: " + firstDate.getTime());

    const lastDate = new Date(Number(lastTimestamp) * 1000);
    lastDate.setHours(0, 0, 0, 0);

    console.log("Filling daily data: last date: " + lastDate.getTime());

    // Process each calendar day.
    const date = new Date(firstDate);

    while (date <= lastDate) {
        const dayTimestamp = Math.floor(date.getTime() / 1000);

        if (!existingDays.has(dayTimestamp)) {
            const nextDate = new Date(date);
            nextDate.setDate(nextDate.getDate() + 1);

            const nextDayTimestamp =
                Math.floor(nextDate.getTime() / 1000);

            // Calculate statistics for this day in the database.
            const result = await db.execute({
                sql: `
                    SELECT
                        MIN(temperature),
                        MAX(temperature),
                        AVG(temperature),
                        COUNT(*)
                    FROM data
                    WHERE timestamp >= ?
                      AND timestamp < ?
                `,
                args: [dayTimestamp, nextDayTimestamp]
            });

            const row = result.rows[0];
            const readingCount = Number(row[3]);

            if (readingCount > 0) {
                await db.execute({
                    sql: `
                        INSERT OR IGNORE INTO daily_reports (
                            timestamp,
                            min_temperature,
                            max_temperature,
                            avg_temperature,
                            reading_count
                        )
                        VALUES (?, ?, ?, ?, ?)
                    `,
                    args: [
                        dayTimestamp,
                        row[0],
                        row[1],
                        row[2],
                        readingCount
                    ]
                });

                console.log(`Created daily report for ${date.toLocaleDateString()}`);
            }
        }

        date.setDate(date.getDate() + 1);
    }

    console.log('Daily report generation complete');
}

// Maybe useful in future
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
    hourlyData = [];
    dailyData = [];
    updateExtremes();

    console.log('Successfully deleted all data');
}

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
    await fillDailyData();
    await getDailyData();

    current = hourlyData[hourlyData.length - 1].temperature;
    updateExtremes();

    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Server listening on port ${PORT}`);
    });
} catch (err) {
    console.error('Server initialization failed:', err);
    process.exit(1);
}

