/**
 * Authentication Routes
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb } = require('../db/init');
const { authenticate, generateToken } = require('../middleware/auth');

const router = express.Router();

/**
 * POST /api/auth/login
 * Body: { username, password }
 * Returns: { token, user: { id, username, role } }
 */
router.post('/login', (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
        }

        const db = getDb();
        const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const valid = bcrypt.compareSync(password, user.password_hash);
        if (!valid) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = generateToken(user);

        // Log the login event
        const { v4: uuidv4 } = require('uuid');
        db.prepare('INSERT INTO event_log (id, user_id, event_type, details_json) VALUES (?, ?, ?, ?)')
            .run(uuidv4(), user.id, 'LOGIN', JSON.stringify({ username: user.username, role: user.role }));

        res.json({
            token,
            user: { id: user.id, username: user.username, role: user.role }
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/auth/me
 * Returns current user profile
 */
router.get('/me', authenticate, (req, res) => {
    res.json({ user: req.user });
});

module.exports = router;
