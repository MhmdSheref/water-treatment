/**
 * Water Purification Decision-Support Tool — Server Entry Point
 */
const express = require('express');
const cors = require('cors');
const path = require('path');

// Load environment variables from .env if it exists
try {
    const fs = require('fs');
    const envPath = path.join(__dirname, '..', '.env');
    if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf-8');
        for (const line of envContent.split('\n')) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#')) {
                const [key, ...valueParts] = trimmed.split('=');
                process.env[key.trim()] = valueParts.join('=').trim();
            }
        }
    }
} catch (e) { /* ignore */ }

// Set defaults
process.env.PORT = process.env.PORT || '3000';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';
process.env.DB_PATH = process.env.DB_PATH || './data/water_dst.db';
process.env.SENSOR_MODE = process.env.SENSOR_MODE || 'placeholder';
process.env.SENSOR_INTERVAL_MS = process.env.SENSOR_INTERVAL_MS || '30000';

const { getDb, closeDb } = require('./db/init');
const { startAutoCollection, stopAutoCollection } = require('./services/sensorService');

// Import routes
const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const techRoutes = require('./routes/techRoutes');

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Serve static frontend files
app.use(express.static(path.join(__dirname, '..', 'public')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/tech', techRoutes);

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString(), sensorMode: process.env.SENSOR_MODE, sensorIntervalMs: parseInt(process.env.SENSOR_INTERVAL_MS) || 30000 });
});

// Fallback to index.html for SPA
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = parseInt(process.env.PORT);
app.listen(PORT, () => {
    console.log(`\n${'='.repeat(60)}`);
    console.log('  Water Purification DST — Server Running');
    console.log(`${'='.repeat(60)}`);
    console.log(`  URL:          http://localhost:${PORT}`);
    console.log(`  Sensor Mode:  ${process.env.SENSOR_MODE}`);
    console.log(`  Database:     ${process.env.DB_PATH}`);
    console.log(`${'='.repeat(60)}\n`);

    // Initialize database
    getDb();

    // Start sensor data collection
    const interval = parseInt(process.env.SENSOR_INTERVAL_MS) || 30000;
    startAutoCollection(interval);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down...');
    stopAutoCollection();
    closeDb();
    process.exit(0);
});

process.on('SIGTERM', () => {
    stopAutoCollection();
    closeDb();
    process.exit(0);
});

module.exports = app;
