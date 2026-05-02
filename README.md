# ReWater

A comprehensive backend and frontend system for monitoring, simulating, and optimizing water purification plants. The tool features real-time sensor data logging, compliance checking against regulatory standards (like the Egyptian Code for Water Reuse), Water Quality Index (WQI) calculation, process sizing, and energy optimization.

## Features

- **Role-based Dashboards:**
  - **Technician:** Real-time sensor monitoring, automated compliance alerts, and quick treatment suggestions.
  - **Admin:** Full simulation engine access, what-if recalcuations, configuration management, and system logs.
- **Sensor Data Management:** Live polling, historical data storage via SQLite, and real-time visualization with Chart.js.
- **Decision Support Engine:**
  - **Deviation Analysis:** Checks sensor readings against customizable regulatory standards.
  - **Water Quality Index (WQI):** AHP-weighted scoring system to quantify overall water health.
  - **Process Sizing:** Calculates Hydraulic Retention Time (HRT) and required reactor volumes/membrane areas based on kinetic models.
  - **Energy Breakdown:** Estimates specific energy consumption (SEC) for pumps and aeration systems.
  - **Optimization (MILP placeholder):** Generates optimal retrofit suggestions based on deviation severity and cost.
- **Comprehensive API documentation:** Accessible locally at `/api-docs.html`.

## Prerequisites

- **Node.js**: v18.0.0 or higher
- **npm**: Comes with Node.js

## Getting Started

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Environment Variables**
   Copy the example environment file and configure it if necessary:
   ```bash
   cp .env.example .env
   ```
   *Note: The app runs perfectly out-of-the-box using the defaults.*

3. **Start the Server**
   ```bash
   npm start
   ```
   Or for development (with auto-restart on file changes):
   ```bash
   npm run dev
   ```

4. **Access the Application**
   Open your browser and navigate to: [http://localhost:3000](http://localhost:3000)

   **Default Accounts:**
   - **Admin:** Username: `admin`, Password: `admin123`
   - **Technician:** Username: `tech`, Password: `tech123`

## Implementing the Backend with Real Sensors

By default, the backend runs in a `placeholder` mode where it generates simulated sensor readings every 30 seconds. To integrate the backend with real physical sensors (e.g., PLCs, edge gateways, or IoT devices):

1. **Update Environment Variables**
   Change the `SENSOR_MODE` in your `.env` file:
   ```env
   SENSOR_MODE=live
   ```

2. **Connect Data Ingestion**
   Locate the file `src/services/sensorService.js`. Modify the `collectReading()` function to query your actual hardware or message broker (like MQTT or an OPC-UA server) instead of generating random values.

3. **API Integration for External Devices**
   If your sensors push data via HTTP rather than the server polling them, you can create a new authenticated `POST /api/sensors/data` endpoint in the routes to accept the incoming JSON payload and save it directly to the database.

## Architecture & File Structure

```
├── data/
│   └── water_dst.db            # Auto-generated SQLite database
├── public/                     # Frontend Vanilla JS/CSS/HTML
│   ├── index.html              # Main application UI
│   ├── api-docs.html           # Interactive API Documentation
│   ├── app.js                  # Frontend logic & Chart.js integration
│   └── style.css               # UI Styling
├── src/
│   ├── db/
│   │   ├── database.js         # SQLite connection & initialization
│   │   └── schema.sql          # Database table definitions
│   ├── engine/                 # Mathematical modeling & logic
│   │   ├── deviation.js        # Compliance checking
│   │   ├── energyBreakdown.js  # SEC calculations
│   │   ├── processSizing.js    # Reactor & membrane sizing
│   │   ├── recommendations.js  # Actionable suggestions mapping
│   │   └── wqi.js              # Water Quality Index calculator
│   ├── middleware/
│   │   └── auth.js             # JWT verification & RBAC authorization
│   ├── routes/                 # Express API handlers
│   │   ├── adminRoutes.js      # Admin endpoints (simulations, config)
│   │   ├── authRoutes.js       # Login endpoints
│   │   └── techRoutes.js       # Technician endpoints (dashboard, history)
│   ├── services/
│   │   └── sensorService.js    # Sensor data ingestion & generation
│   └── server.js               # Express app entry point
├── tests/
│   └── engine.test.js          # Node native test runner test suite
└── package.json
```

## Running Tests

The mathematical engine is heavily tested using the native Node.js test runner (`node:test`). To run the test suite:

```bash
npm test
```
