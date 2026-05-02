/**
 * ReWater — Frontend Application
 */
(function () {
    'use strict';

    const API = '';
    let token = null;
    let currentUser = null;
    let dashboardInterval = null;
    let chartPollInterval = null;
    let sensorChartInstance = null;
    let monitoringChartInstance = null;
    let currentChartHours = 1;
    let lastSeenReadingId = null;
    let sensorIntervalMs = 30000; // default, updated from /api/health

    // ---- Utility ----
    async function api(path, options = {}) {
        const headers = { 'Content-Type': 'application/json', ...options.headers };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch(`${API}${path}`, { ...options, headers });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        return data;
    }

    function $(sel) { return document.querySelector(sel); }
    function $$(sel) { return document.querySelectorAll(sel); }

    function formatSimulationValue(value) {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric.toFixed(2) : '';
    }

    // ---- Auth ----
    $('#login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = $('#login-btn');
        const err = $('#login-error');
        btn.textContent = 'Signing in...';
        btn.disabled = true;
        err.textContent = '';

        try {
            const data = await api('/api/auth/login', {
                method: 'POST',
                body: JSON.stringify({
                    username: $('#username').value,
                    password: $('#password').value
                })
            });
            token = data.token;
            currentUser = data.user;
            enterApp();
        } catch (e) {
            err.textContent = e.message;
        } finally {
            btn.textContent = 'Sign In';
            btn.disabled = false;
        }
    });

    $('#logout-btn').addEventListener('click', () => {
        token = null;
        currentUser = null;
        if (dashboardInterval) clearInterval(dashboardInterval);
        stopChartPolling();
        $('#app-screen').classList.remove('active');
        $('#login-screen').classList.add('active');
    });

    function enterApp() {
        $('#login-screen').classList.remove('active');
        $('#app-screen').classList.add('active');

        // Set user badge
        const badge = $('#user-badge');
        badge.textContent = currentUser.role;
        badge.className = `user-badge ${currentUser.role}`;

        // Show/hide admin tabs
        const isAdmin = currentUser.role === 'admin';
        $('#nav-simulation').style.display = isAdmin ? '' : 'none';
        $('#nav-monitoring').style.display = isAdmin ? '' : 'none';
        $('#nav-logs').style.display = isAdmin ? '' : 'none';
        $('#nav-config').style.display = isAdmin ? '' : 'none';

        // Switch to dashboard
        switchView('dashboard');

        // Fetch sensor interval from health endpoint then start polling
        fetch('/api/health').then(r => r.json()).then(h => {
            sensorIntervalMs = parseInt(h.sensorIntervalMs) || 30000;
        }).catch(() => {});

        // Start auto-refresh
        loadDashboard();
        dashboardInterval = setInterval(loadDashboard, 15000);
    }

    // ---- Navigation ----
    $$('.nav-tab').forEach(tab => {
        tab.addEventListener('click', () => switchView(tab.dataset.view));
    });

    function switchView(viewName) {
        $$('.nav-tab').forEach(t => t.classList.remove('active'));
        $$(`.nav-tab[data-view="${viewName}"]`).forEach(t => t.classList.add('active'));
        $$('.view').forEach(v => v.classList.remove('active'));
        $(`#view-${viewName}`).classList.add('active');

        if (viewName === 'dashboard') loadDashboard();
        if (viewName === 'simulation') loadSimHistory();
        if (viewName === 'logs') loadLogs();
        if (viewName === 'config') loadConfig();
        if (viewName === 'monitoring') initMonitoringView();

        // Chart: start/stop live polling based on active view
        if (viewName === 'dashboard') {
            loadSensorChart(currentChartHours).then(() => startChartPolling());
        } else {
            stopChartPolling();
        }
    }

    // ---- Dashboard ----
    async function loadDashboard() {
        try {
            const [dashboard, suggestions, alerts] = await Promise.all([
                api('/api/tech/dashboard'),
                api('/api/tech/suggestions'),
                api('/api/tech/alerts')
            ]);

            if (!dashboard.reading && !dashboard.data) {
                return;
            }

            const data = dashboard;

            // Timestamp
            $('#dashboard-time').textContent = `Updated: ${new Date(data.timestamp).toLocaleString()}`;

            // WQI
            const wqiVal = data.wqi.score;
            $('#wqi-value').textContent = wqiVal;
            const label = $('#wqi-label');
            label.textContent = data.wqi.interpretation;
            label.className = `wqi-label ${data.wqi.interpretation.toLowerCase().replace(' ', '-')}`;

            // WQI circle gradient based on score
            const pct = Math.min(wqiVal / 200 * 100, 100);
            const circleColor = wqiVal <= 75 ? 'var(--accent-green)' :
                                wqiVal <= 100 ? 'var(--accent-cyan)' :
                                wqiVal <= 150 ? 'var(--accent-yellow)' : 'var(--accent-red)';
            $('#wqi-circle').style.background = `conic-gradient(${circleColor} 0%, ${circleColor} ${pct}%, rgba(30,41,59,0.4) ${pct}%)`;

            // Compliance
            const comp = data.compliance;
            const icon = $('#compliance-icon');
            icon.className = `compliance-icon ${comp.overall ? 'ok' : 'fail'}`;
            icon.textContent = comp.overall ? '✓' : '✗';
            $('#compliance-text').textContent = comp.overall
                ? 'All parameters within limits'
                : `${comp.nonCompliantCount} parameter(s) out of compliance`;

            const details = $('#compliance-details');
            details.innerHTML = '';
            const params = ['BOD', 'COD', 'TSS', 'TN', 'TP', 'EC', 'Na', 'heavy_metals'];
            for (const p of params) {
                const isFail = comp.flags[p];
                const div = document.createElement('div');
                div.className = `compliance-item ${isFail ? 'fail' : 'pass'}`;
                div.innerHTML = `<span>${p}</span><span>${isFail ? '⚠ Exceeded' : '✓ OK'}</span>`;
                details.appendChild(div);
            }

            // Readings
            const grid = $('#readings-grid');
            grid.innerHTML = '';
            const reading = data.reading;
            const units = {
                pH: '', BOD: 'mg/L', COD: 'mg/L', TSS: 'mg/L', TN: 'mg/L',
                TP: 'mg/L', EC: 'dS/m', Na: 'mg/L', heavy_metals: 'mg/L',
                flow_rate: 'm³/h', temperature: '°C'
            };

            for (const [key, val] of Object.entries(reading)) {
                const tile = document.createElement('div');
                const isAlert = comp.flags && comp.flags[key];
                tile.className = `reading-tile ${isAlert ? 'alert' : ''}`;
                tile.innerHTML = `
                    <div class="label">${key.replace('_', ' ')}</div>
                    <div class="value">${val}</div>
                    <div class="unit">${units[key] || ''}</div>
                `;
                grid.appendChild(tile);
            }

            // Suggestions
            const sugList = $('#suggestions-list');
            if (suggestions.suggestions.length === 0) {
                sugList.innerHTML = '<div class="no-alerts">✓ No issues detected — all systems operating normally</div>';
            } else {
                sugList.innerHTML = suggestions.suggestions.map(s => `
                    <div class="suggestion-item ${s.urgency}">
                        <span class="suggestion-badge ${s.urgency}">${s.urgency}</span>
                        <div class="suggestion-content">
                            <div class="suggestion-param">${s.parameter}</div>
                            <div class="suggestion-action">${s.action}</div>
                        </div>
                    </div>
                `).join('');
            }

            // Alerts
            const alertList = $('#alerts-list');
            if (alerts.alerts.length === 0) {
                alertList.innerHTML = '<div class="no-alerts">✓ No active alerts</div>';
            } else {
                alertList.innerHTML = alerts.alerts.map(a => `
                    <div class="alert-item ${a.severity}">
                        <span><strong>${a.parameter}</strong>: ${a.measured} (limit: ${a.limit})</span>
                        <span class="suggestion-badge ${a.severity === 'critical' ? 'critical' : a.severity === 'warning' ? 'high' : 'medium'}">${a.severity}</span>
                    </div>
                `).join('');
            }

        } catch (err) {
            console.error('Dashboard error:', err);
        }
    }

    $('#refresh-dashboard').addEventListener('click', () => {
        loadDashboard();
        loadSensorChart(currentChartHours);
    });

    // ---- Sensor Trend Chart — Live Polling ----

    function stopChartPolling() {
        if (chartPollInterval) { clearInterval(chartPollInterval); chartPollInterval = null; }
        setLiveIndicator(false);
    }

    function startChartPolling() {
        stopChartPolling();
        setLiveIndicator(true);
        chartPollInterval = setInterval(appendLatestReading, sensorIntervalMs);
    }

    function setLiveIndicator(on) {
        const el = $('#live-dot');
        if (!el) return;
        el.style.display = on ? '' : 'none';
    }

    // ---- Sensor Trend Chart ----

    // Chart.js global defaults
    Chart.defaults.color = '#94a3b8';
    Chart.defaults.borderColor = 'rgba(99,124,171,0.15)';

    const CHART_PALETTE = [
        '#06b6d4', '#3b82f6', '#22c55e', '#eab308', '#a855f7',
        '#ef4444', '#f97316', '#ec4899', '#14b8a6', '#8b5cf6', '#f59e0b'
    ];

    const PARAM_UNITS = {
        BOD: 'mg/L', COD: 'mg/L', TSS: 'mg/L', TN: 'mg/L', TP: 'mg/L',
        pH: '', EC: 'dS/m', Na: 'mg/L', heavy_metals: 'mg/L',
        flow_rate: 'm³/h', temperature: '°C'
    };

    async function loadSensorChart(hours) {
        currentChartHours = hours;
        lastSeenReadingId = null;
        try {
            const data = await api(`/api/tech/readings/history?hours=${hours}&limit=120`);
            if (!data.readings || data.readings.length === 0) {
                if (sensorChartInstance) { sensorChartInstance.destroy(); sensorChartInstance = null; }
                return;
            }

            // Track last reading id for incremental updates
            lastSeenReadingId = data.readings[data.readings.length - 1].id;

            const labels = data.readings.map(r =>
                new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            );

            const dashboardParams = ['BOD', 'COD', 'TSS', 'pH', 'flow_rate'];
            const datasets = dashboardParams.map((param, i) => ({
                label: `${param}${PARAM_UNITS[param] ? ' (' + PARAM_UNITS[param] + ')' : ''}`,
                data: data.readings.map(r => r[param] ?? null),
                borderColor: CHART_PALETTE[i],
                backgroundColor: CHART_PALETTE[i] + '22',
                borderWidth: 2,
                pointRadius: data.readings.length > 50 ? 0 : 3,
                pointHoverRadius: 5,
                tension: 0.4,
                fill: false
            }));

            const ctx = $('#sensor-chart').getContext('2d');
            if (sensorChartInstance) sensorChartInstance.destroy();
            sensorChartInstance = new Chart(ctx, {
                type: 'line',
                data: { labels, datasets },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: { duration: 400 },
                    interaction: { mode: 'index', intersect: false },
                    plugins: {
                        legend: { position: 'top', labels: { usePointStyle: true, padding: 16, font: { size: 11 } } },
                        tooltip: { backgroundColor: 'rgba(10,14,26,0.95)', borderColor: 'rgba(99,124,171,0.3)', borderWidth: 1 }
                    },
                    scales: {
                        x: { grid: { color: 'rgba(99,124,171,0.1)' }, ticks: { maxTicksLimit: 8, font: { size: 11 } } },
                        y: { grid: { color: 'rgba(99,124,171,0.1)' }, ticks: { font: { size: 11 } } }
                    }
                }
            });
        } catch (err) {
            console.error('Sensor chart error:', err);
        }
    }

    // Append only the newest reading(s) to an already-rendered chart
    async function appendLatestReading() {
        if (!sensorChartInstance) return;
        try {
            const data = await api(`/api/tech/readings/history?hours=${currentChartHours}&limit=5`);
            if (!data.readings || data.readings.length === 0) return;

            // Find readings newer than the last one we rendered
            const newReadings = lastSeenReadingId
                ? data.readings.filter(r => r.id > lastSeenReadingId)
                : data.readings.slice(-1);

            if (newReadings.length === 0) return;

            const dashboardParams = ['BOD', 'COD', 'TSS', 'pH', 'flow_rate'];
            const MAX_POINTS = 120;

            for (const reading of newReadings) {
                const label = new Date(reading.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                sensorChartInstance.data.labels.push(label);

                dashboardParams.forEach((param, i) => {
                    sensorChartInstance.data.datasets[i].data.push(reading[param] ?? null);
                });

                // Keep chart window at MAX_POINTS
                if (sensorChartInstance.data.labels.length > MAX_POINTS) {
                    sensorChartInstance.data.labels.shift();
                    sensorChartInstance.data.datasets.forEach(ds => ds.data.shift());
                }

                lastSeenReadingId = reading.id;
            }

            sensorChartInstance.update('active');

            // Flash live dot to signal update
            const dot = $('#live-dot');
            if (dot) {
                dot.classList.add('live-flash');
                setTimeout(() => dot.classList.remove('live-flash'), 600);
            }
        } catch (err) {
            console.error('Chart live update error:', err);
        }
    }

    // Timespan toggle
    $$('.ts-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            $$('.ts-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            loadSensorChart(parseInt(btn.dataset.hours));
        });
    });

    // ---- Simulation ----
    $('#sim-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = $('#run-sim-btn');
        btn.textContent = 'Running...';
        btn.disabled = true;

        try {
            const params = {};
            const fields = ['BOD', 'COD', 'TSS', 'TN', 'TP', 'EC', 'Na', 'heavy_metals', 'flow_rate', 'pathogens'];
            for (const f of fields) {
                params[f] = parseFloat($(`#sim-${f}`).value) || 0;
            }

            const result = await api('/api/admin/simulate', {
                method: 'POST',
                body: JSON.stringify(params)
            });

            renderSimResults(result);
            loadSimHistory();
        } catch (err) {
            $('#sim-results').innerHTML = `<p class="error-text">${err.message}</p>`;
        } finally {
            btn.textContent = 'Run Simulation';
            btn.disabled = false;
        }
    });

    $('#load-current-btn').addEventListener('click', async () => {
        try {
            const dashboard = await api('/api/tech/dashboard');
            if (dashboard.reading) {
                const r = dashboard.reading;
                const fields = ['BOD', 'COD', 'TSS', 'TN', 'TP', 'EC', 'Na', 'heavy_metals', 'flow_rate', 'pathogens'];
                for (const f of fields) {
                    if (r[f] !== undefined) $(`#sim-${f}`).value = formatSimulationValue(r[f]);
                }
            }
        } catch (err) {
            console.error('Load current readings error:', err);
        }
    });

    function renderSimResults(result) {
        const container = $('#sim-results');
        let html = '';

        // WQI
        html += `<div class="result-section">
            <h4>Water Quality Index</h4>
            <div class="result-row"><span class="label">WQI Score</span><span class="value">${result.wqi.wqi}</span></div>
            <div class="result-row"><span class="label">Interpretation</span><span class="value ${result.wqi.wqi <= 100 ? 'good' : 'bad'}">${result.wqi.interpretation}</span></div>
        </div>`;

        // Deviation
        html += `<div class="result-section"><h4>Compliance Analysis</h4>`;
        if (result.deviation.nonCompliantParams.length === 0) {
            html += `<div class="result-row"><span class="value good">All parameters compliant ✓</span></div>`;
        } else {
            for (const p of result.deviation.nonCompliantParams) {
                html += `<div class="result-row">
                    <span class="label">${p}</span>
                    <span class="value bad">Deviation: +${result.deviation.deviations[p]?.toFixed(2)}</span>
                </div>`;
            }
        }
        html += '</div>';

        // Sizing
        if (result.sizing && Object.keys(result.sizing).length > 0) {
            html += `<div class="result-section"><h4>Reactor Sizing</h4>`;
            if (result.sizing.biological) {
                html += `<div class="result-row"><span class="label">HRT</span><span class="value">${result.sizing.biological.hrt_hours} hours</span></div>`;
                html += `<div class="result-row"><span class="label">Reactor Volume</span><span class="value">${result.sizing.biological.reactor_volume_m3} m³</span></div>`;
            }
            if (result.sizing.uf_area_m2) {
                html += `<div class="result-row"><span class="label">UF Area</span><span class="value">${result.sizing.uf_area_m2} m²</span></div>`;
            }
            if (result.sizing.membrane_uf) {
                html += `<div class="result-row"><span class="label">UF Area (Darcy)</span><span class="value">${result.sizing.membrane_uf.area_m2} m² (flux: ${result.sizing.membrane_uf.flux_m3_m2_h} m³/m²·h)</span></div>`;
            }
            if (result.sizing.ro_area_m2) {
                html += `<div class="result-row"><span class="label">RO Area</span><span class="value">${result.sizing.ro_area_m2} m²</span></div>`;
            }
            if (result.sizing.membrane_ro) {
                html += `<div class="result-row"><span class="label">RO Area (Darcy)</span><span class="value">${result.sizing.membrane_ro.area_m2} m² (flux: ${result.sizing.membrane_ro.flux_m3_m2_h} m³/m²·h)</span></div>`;
            }
            if (result.sizing.uv) {
                html += `<div class="result-row"><span class="label">UV Dose Required</span><span class="value">${result.sizing.uv.dose_mJ_cm2} mJ/cm²</span></div>`;
                html += `<div class="result-row"><span class="label">UV Log Reduction</span><span class="value">${result.sizing.uv.log_reduction}-log</span></div>`;
            }
            html += '</div>';
        }

        // Energy
        html += `<div class="result-section"><h4>Energy Profile</h4>`;
        const e = result.energy;
        html += `<div class="result-row"><span class="label">Aeration</span><span class="value">${e.components_kW.aeration} kW</span></div>`;
        html += `<div class="result-row"><span class="label">Pumps</span><span class="value">${e.components_kW.pumps} kW</span></div>`;
        html += `<div class="result-row"><span class="label">Membranes</span><span class="value">${e.components_kW.membranes} kW</span></div>`;
        if (e.components_kW.uv !== undefined) {
            html += `<div class="result-row"><span class="label">UV Disinfection</span><span class="value">${e.components_kW.uv} kW</span></div>`;
        }
        html += `<div class="result-row"><span class="label">Auxiliary</span><span class="value">${e.components_kW.auxiliary} kW</span></div>`;
        html += `<div class="result-row"><span class="label">Total Power</span><span class="value">${e.total_power_kW} kW</span></div>`;
        html += `<div class="result-row"><span class="label">SEC</span><span class="value">${e.sec_kWh_per_m3} kWh/m³</span></div>`;
        html += '</div>';

        // Optimization
        if (result.optimization) {
            html += `<div class="result-section"><h4>Recommended Upgrades (MILP Optimized)</h4>`;
            if (result.optimization.feasible && result.optimization.selectedUpgrades.length > 0) {
                for (const u of result.optimization.selectedUpgrades) {
                    html += `<div class="upgrade-item">
                        <div class="name">${u.name}</div>
                        <div class="meta">Type: ${u.type} | Cost: $${u.cost.toLocaleString()} | SEC: ${u.sec} kWh/m³</div>
                    </div>`;
                }
                html += `<div class="result-row"><span class="label">Total Estimated Cost</span><span class="value">$${result.optimization.totalCost.toLocaleString()}</span></div>`;
                html += `<div class="result-row"><span class="label">Total SEC</span><span class="value">${result.optimization.totalSec} kWh/m³</span></div>`;
            } else {
                html += `<div class="result-row"><span class="value good">System already compliant or no feasible upgrades needed</span></div>`;
            }
            html += '</div>';
        }

        // Recommendations
        if (result.recommendations && result.recommendations.length > 0) {
            html += `<div class="result-section"><h4>Detailed Recommendations</h4>`;
            for (const r of result.recommendations) {
                html += `<div class="suggestion-item ${r.urgency}" style="margin-bottom:0.4rem">
                    <span class="suggestion-badge ${r.urgency}">${r.urgency}</span>
                    <div class="suggestion-content">
                        <div class="suggestion-param">${r.parameter} — ${r.category}</div>
                        ${r.suggestions.map(s => `<div class="suggestion-action">• ${s}</div>`).join('')}
                    </div>
                </div>`;
            }
            html += '</div>';
        }

        container.innerHTML = html;
    }

    async function loadSimHistory() {
        try {
            const data = await api('/api/admin/simulations?limit=10');
            const container = $('#sim-history');

            if (!data.simulations || data.simulations.length === 0) {
                container.innerHTML = '<p class="muted">No past simulations.</p>';
                return;
            }

            let html = `<table class="sim-history-table">
                <thead><tr><th>Time</th><th>User</th><th>WQI</th><th>Issues</th></tr></thead><tbody>`;

            for (const sim of data.simulations) {
                const result = JSON.parse(sim.result_json);
                html += `<tr>
                    <td>${new Date(sim.timestamp).toLocaleString()}</td>
                    <td>${sim.username || 'N/A'}</td>
                    <td>${result.wqi?.wqi || '—'}</td>
                    <td>${result.deviation?.nonCompliantParams?.length || 0} non-compliant</td>
                </tr>`;
            }
            html += '</tbody></table>';
            container.innerHTML = html;
        } catch (err) {
            console.error('Load sim history error:', err);
        }
    }

    // ---- Logs ----
    async function loadLogs() {
        try {
            const filter = $('#log-filter').value;
            const query = filter ? `?type=${filter}&limit=50` : '?limit=50';
            const data = await api(`/api/admin/logs${query}`);
            const tbody = $('#logs-tbody');

            if (!data.events || data.events.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" class="muted" style="text-align:center;padding:2rem">No events found</td></tr>';
                return;
            }

            tbody.innerHTML = data.events.map(ev => `
                <tr>
                    <td>${new Date(ev.timestamp).toLocaleString()}</td>
                    <td>${ev.username || 'System'}</td>
                    <td><span class="event-badge ${ev.event_type}">${ev.event_type}</span></td>
                    <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${ev.details_json || ''}</td>
                </tr>
            `).join('');
        } catch (err) {
            console.error('Load logs error:', err);
        }
    }

    $('#log-filter').addEventListener('change', loadLogs);
    $('#refresh-logs').addEventListener('click', loadLogs);

    // ---- Config ----
    async function loadConfig() {
        try {
            const data = await api('/api/admin/config');
            const container = $('#config-sections');

            // Group configs by prefix
            const groups = {};
            for (const item of data.config) {
                const parts = item.key.split('_');
                const group = parts[0];
                if (!groups[group]) groups[group] = [];
                groups[group].push(item);
            }

            const groupLabels = {
                standards: 'Regulatory Standards',
                lod: 'Limits of Detection',
                weight: 'AHP Weights (WQI)',
                k: 'Kinetic Constants',
                membrane: 'Membrane Parameters',
                pump: 'Pump Parameters',
                operating: 'Operating Parameters',
                fluid: 'Fluid Properties',
                gravity: 'Physical Constants',
                opt: 'Optimization Weights'
            };

            container.innerHTML = Object.entries(groups).map(([group, items]) => `
                <div class="config-group">
                    <div class="config-group-header">${groupLabels[group] || group}</div>
                    ${items.map(item => `
                        <div class="config-item">
                            <label>${item.description || item.key}</label>
                            <input type="text" data-key="${item.key}" value="${item.value}">
                        </div>
                    `).join('')}
                </div>
            `).join('');
        } catch (err) {
            console.error('Load config error:', err);
        }
    }

    $('#save-config').addEventListener('click', async () => {
        try {
            const inputs = $$('#config-sections input[data-key]');
            const updates = {};
            inputs.forEach(inp => {
                updates[inp.dataset.key] = inp.value;
            });

            await api('/api/admin/config', {
                method: 'PUT',
                body: JSON.stringify(updates)
            });

            // Flash save button
            const btn = $('#save-config');
            btn.textContent = '✓ Saved';
            btn.style.background = 'var(--accent-green)';
            setTimeout(() => {
                btn.textContent = 'Save Changes';
                btn.style.background = '';
            }, 2000);
        } catch (err) {
            console.error('Save config error:', err);
        }
    });

    // ---- Monitoring View (Admin only) ----

    function initMonitoringView() {
        // Default date range: last 24h
        const now = new Date();
        const past = new Date(now - 24 * 60 * 60 * 1000);
        const toISO = d => d.toISOString().slice(0, 16);
        if (!$('#mon-from').value) $('#mon-from').value = toISO(past);
        if (!$('#mon-to').value) $('#mon-to').value = toISO(now);
    }

    $('#mon-load-btn').addEventListener('click', loadMonitoringData);

    async function loadMonitoringData() {
        const btn = $('#mon-load-btn');
        btn.textContent = 'Loading...';
        btn.disabled = true;

        try {
            const from = $('#mon-from').value;
            const to = $('#mon-to').value;
            const selectedParams = [...$$('#mon-param-checks input:checked')].map(el => el.value);

            if (selectedParams.length === 0) {
                alert('Please select at least one parameter.');
                return;
            }

            const qs = new URLSearchParams();
            if (from) qs.set('from', new Date(from).toISOString());
            if (to) qs.set('to', new Date(to).toISOString());
            qs.set('limit', '2000');

            const data = await api(`/api/admin/readings?${qs}`);

            if (!data.readings || data.readings.length === 0) {
                $('#mon-chart-meta').textContent = 'No data for selected range.';
                return;
            }

            $('#mon-chart-meta').textContent = `${data.count} readings`;
            $('#mon-row-count').textContent = `${data.count} rows`;

            // Render chart
            const labels = data.readings.map(r =>
                new Date(r.timestamp).toLocaleString([], { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })
            );

            const datasets = selectedParams.map((param, i) => ({
                label: `${param}${PARAM_UNITS[param] ? ' (' + PARAM_UNITS[param] + ')' : ''}`,
                data: data.readings.map(r => r[param] ?? null),
                borderColor: CHART_PALETTE[i % CHART_PALETTE.length],
                backgroundColor: CHART_PALETTE[i % CHART_PALETTE.length] + '22',
                borderWidth: 2,
                pointRadius: data.readings.length > 100 ? 0 : 3,
                pointHoverRadius: 5,
                tension: 0.4,
                fill: false
            }));

            const monCtx = $('#monitoring-chart').getContext('2d');
            if (monitoringChartInstance) monitoringChartInstance.destroy();
            monitoringChartInstance = new Chart(monCtx, {
                type: 'line',
                data: { labels, datasets },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: {
                        legend: { position: 'top', labels: { usePointStyle: true, padding: 14, font: { size: 11 } } },
                        tooltip: { backgroundColor: 'rgba(10,14,26,0.95)', borderColor: 'rgba(99,124,171,0.3)', borderWidth: 1 }
                    },
                    scales: {
                        x: { grid: { color: 'rgba(99,124,171,0.1)' }, ticks: { maxTicksLimit: 10, font: { size: 10 }, maxRotation: 30 } },
                        y: { grid: { color: 'rgba(99,124,171,0.1)' }, ticks: { font: { size: 11 } } }
                    }
                }
            });

            // Render stats
            const statsEl = $('#mon-stats');
            statsEl.innerHTML = selectedParams.map(p => {
                const s = data.stats[p];
                if (!s) return '';
                return `<div class="stat-card">
                    <div class="stat-param">${p}</div>
                    <div class="stat-row"><span>Min</span><span class="stat-val">${s.min}</span></div>
                    <div class="stat-row"><span>Avg</span><span class="stat-val" style="color:var(--accent-cyan)">${s.avg}</span></div>
                    <div class="stat-row"><span>Max</span><span class="stat-val">${s.max}</span></div>
                </div>`;
            }).join('');

            // Render raw table
            const tableParams = ['timestamp', ...selectedParams];
            let tableHtml = `<table class="data-table mon-data-table"><thead><tr>${
                tableParams.map(p => `<th>${p}</th>`).join('')
            }</tr></thead><tbody>`;
            for (const row of data.readings) {
                tableHtml += '<tr>' + tableParams.map(p => {
                    if (p === 'timestamp') return `<td>${new Date(row.timestamp).toLocaleString()}</td>`;
                    const v = row[p];
                    return `<td>${v != null ? v : '—'}</td>`;
                }).join('') + '</tr>';
            }
            tableHtml += '</tbody></table>';
            $('#mon-table-wrapper').innerHTML = tableHtml;

        } catch (err) {
            console.error('Monitoring load error:', err);
            $('#mon-chart-meta').textContent = 'Error loading data.';
        } finally {
            btn.textContent = 'Load Data';
            btn.disabled = false;
        }
    }

})();
