require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');
const { execSync } = require('child_process');
const { Server } = require('socket.io');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Default to 3003 locally, or use Railway's dynamic PORT environment variable in production
const PORT = parseInt(process.env.PORT, 10) || 3003;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static assets from project root
app.use(express.static(__dirname));

// Root route fallback for proxies/ngrok
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ============================================================================
// POSTGRESQL DATABASE CONNECTOR & HYDRATION LAYER
// ============================================================================
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway')
        ? { rejectUnauthorized: false }
        : false
});

// In-Memory Database Caches (Hydrated from PostgreSQL)
const farmerDatabase = {};
const investorDatabase = {};

// ----------------------------------------------------------------------------
// FARMER DB HELPERS (UNTOUCHED GROWER CODE)
// ----------------------------------------------------------------------------
async function saveFarmerDb(farmer) {
    if (!process.env.DATABASE_URL) return;
    try {
        await pool.query(`
            INSERT INTO farmers (grower_code, pin, farmer_name, farmer_group, location, balance_tati)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (grower_code) DO UPDATE SET
                pin = EXCLUDED.pin,
                farmer_name = EXCLUDED.farmer_name,
                farmer_group = EXCLUDED.farmer_group,
                location = EXCLUDED.location,
                balance_tati = EXCLUDED.balance_tati;
        `, [farmer.growerCode, farmer.pin, farmer.farmerName, farmer.farmerGroup, farmer.location, farmer.balanceTati]);
    } catch (err) {
        console.error('❌ DB Farmer Save Error:', err.message);
    }
}

async function saveReceiptDb(receipt) {
    if (!process.env.DATABASE_URL) return;
    try {
        await pool.query(`
            INSERT INTO receipts (
                gatepass_id, grower_code, farmer_name, farmer_group, 
                bundle_weight_tons, usd_valuation, tati_minted, location, timestamp, type
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (gatepass_id) DO NOTHING;
        `, [
            receipt.gatepassId, receipt.growerCode, receipt.farmerName, receipt.farmerGroup,
            receipt.bundleWeightTons, receipt.usdValuation, receipt.tatiMinted, 
            receipt.location, receipt.timestamp, receipt.type
        ]);
    } catch (err) {
        console.error('❌ DB Receipt Save Error:', err.message);
    }
}

// ----------------------------------------------------------------------------
// INVESTOR DB HELPERS (INVESTOR BRANCH)
// ----------------------------------------------------------------------------
async function saveInvestorDb(investor) {
    if (!process.env.DATABASE_URL) return;
    try {
        await pool.query(`
            INSERT INTO investors (investor_id, email, pin, investor_name, usd_balance, tati_balance)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (investor_id) DO UPDATE SET
                email = EXCLUDED.email,
                pin = EXCLUDED.pin,
                investor_name = EXCLUDED.investor_name,
                usd_balance = EXCLUDED.usd_balance,
                tati_balance = EXCLUDED.tati_balance;
        `, [investor.investorId, investor.email, investor.pin, investor.investorName, investor.usdBalance, investor.tatiBalance]);
    } catch (err) {
        console.error('❌ DB Investor Save Error:', err.message);
    }
}

async function saveInvestorTxDb(tx) {
    if (!process.env.DATABASE_URL) return;
    try {
        await pool.query(`
            INSERT INTO investor_transactions (
                tx_id, investor_id, type, amount_usd, amount_tati, payment_gateway, status, timestamp
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (tx_id) DO NOTHING;
        `, [tx.txId, tx.investorId, tx.type, tx.amountUsd, tx.amountTati, tx.paymentGateway, tx.status, tx.timestamp]);
    } catch (err) {
        console.error('❌ DB Investor Tx Save Error:', err.message);
    }
}

// Auto-initialize tables and load initial data from DB
async function initDb() {
    if (!process.env.DATABASE_URL) {
        console.log('⚠️ No DATABASE_URL found. Running with transient in-memory storage.');
        seedInitialMemoryCache();
        return;
    }

    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS farmers (
                grower_code VARCHAR(50) PRIMARY KEY,
                pin VARCHAR(10) NOT NULL,
                farmer_name VARCHAR(100) NOT NULL,
                farmer_group VARCHAR(100),
                location VARCHAR(100),
                balance_tati NUMERIC(12, 2) DEFAULT 0.00
            );

            CREATE TABLE IF NOT EXISTS receipts (
                id SERIAL PRIMARY KEY,
                gatepass_id VARCHAR(50) UNIQUE NOT NULL,
                grower_code VARCHAR(50) REFERENCES farmers(grower_code),
                farmer_name VARCHAR(100),
                farmer_group VARCHAR(100),
                bundle_weight_tons NUMERIC(10, 2),
                usd_valuation VARCHAR(50),
                tati_minted VARCHAR(50),
                location VARCHAR(100),
                timestamp VARCHAR(100),
                type VARCHAR(50)
            );

            CREATE TABLE IF NOT EXISTS investors (
                investor_id VARCHAR(50) PRIMARY KEY,
                email VARCHAR(100) UNIQUE NOT NULL,
                pin VARCHAR(10) NOT NULL,
                investor_name VARCHAR(100) NOT NULL,
                usd_balance NUMERIC(12, 2) DEFAULT 0.00,
                tati_balance NUMERIC(12, 2) DEFAULT 0.00
            );

            CREATE TABLE IF NOT EXISTS investor_transactions (
                id SERIAL PRIMARY KEY,
                tx_id VARCHAR(50) UNIQUE NOT NULL,
                investor_id VARCHAR(50) REFERENCES investors(investor_id),
                type VARCHAR(20) NOT NULL,
                amount_usd NUMERIC(12, 2),
                amount_tati NUMERIC(12, 2),
                payment_gateway VARCHAR(50),
                status VARCHAR(20) DEFAULT 'COMPLETED',
                timestamp VARCHAR(100)
            );
        `);

        // Seed initial records if empty
        const resFarmers = await pool.query('SELECT * FROM farmers;');
        if (resFarmers.rows.length === 0) {
            console.log('🌱 Seeding initial records into PostgreSQL...');
            seedInitialMemoryCache();
            for (const code of Object.keys(farmerDatabase)) {
                const f = farmerDatabase[code];
                await saveFarmerDb(f);
                for (const r of f.receiptLedger) {
                    await saveReceiptDb(r);
                }
            }
            for (const id of Object.keys(investorDatabase)) {
                const inv = investorDatabase[id];
                await saveInvestorDb(inv);
                for (const tx of inv.transactionLedger) {
                    await saveInvestorTxDb(tx);
                }
            }
        } else {
            console.log('🔄 Hydrating memory cache from PostgreSQL database...');
            // Hydrate Farmers
            for (const row of resFarmers.rows) {
                farmerDatabase[row.grower_code] = {
                    growerCode: row.grower_code,
                    pin: row.pin,
                    farmerName: row.farmer_name,
                    farmerGroup: row.farmer_group,
                    location: row.location,
                    balanceTati: parseFloat(row.balance_tati),
                    receiptLedger: []
                };
            }

            const resReceipts = await pool.query('SELECT * FROM receipts ORDER BY id DESC;');
            for (const row of resReceipts.rows) {
                if (farmerDatabase[row.grower_code]) {
                    farmerDatabase[row.grower_code].receiptLedger.push({
                        gatepassId: row.gatepass_id,
                        growerCode: row.grower_code,
                        farmerName: row.farmer_name,
                        farmerGroup: row.farmer_group,
                        bundleWeightTons: parseFloat(row.bundle_weight_tons),
                        usdValuation: row.usd_valuation,
                        tatiMinted: row.tati_minted,
                        location: row.location,
                        timestamp: row.timestamp,
                        type: row.type
                    });
                }
            }

            // Hydrate Investors
            const resInvestors = await pool.query('SELECT * FROM investors;');
            for (const row of resInvestors.rows) {
                investorDatabase[row.investor_id] = {
                    investorId: row.investor_id,
                    email: row.email,
                    pin: row.pin,
                    investorName: row.investor_name,
                    usdBalance: parseFloat(row.usd_balance),
                    tatiBalance: parseFloat(row.tati_balance),
                    transactionLedger: []
                };
            }

            const resInvTx = await pool.query('SELECT * FROM investor_transactions ORDER BY id DESC;');
            for (const row of resInvTx.rows) {
                if (investorDatabase[row.investor_id]) {
                    investorDatabase[row.investor_id].transactionLedger.push({
                        txId: row.tx_id,
                        investorId: row.investor_id,
                        type: row.type,
                        amountUsd: parseFloat(row.amount_usd),
                        amountTati: parseFloat(row.amount_tati),
                        paymentGateway: row.payment_gateway,
                        status: row.status,
                        timestamp: row.timestamp
                    });
                }
            }
        }
        console.log('✅ PostgreSQL Database connected and state fully hydrated!');
    } catch (err) {
        console.error('❌ Database Initialization Error:', err.message);
        seedInitialMemoryCache();
    }
}

function seedInitialMemoryCache() {
    // Grower Seed Data
    farmerDatabase["GW-1001"] = {
        growerCode: "GW-1001",
        pin: "1234",
        farmerName: "Tatenda Nyoni",
        farmerGroup: "The Huletts Sunsweet® Reserve",
        location: "Hippo Valley Estate",
        balanceTati: 1250.00,
        receiptLedger: [
            {
                gatepassId: "GP-88201",
                growerCode: "GW-1001",
                farmerName: "Tatenda Nyoni",
                farmerGroup: "The Huletts Sunsweet® Reserve",
                bundleWeightTons: 6.2,
                usdValuation: "$527.00 USD",
                tatiMinted: "+6.20 TATI",
                location: "Triangle Mill Gate 1",
                timestamp: new Date(Date.now() - 3600000).toLocaleTimeString(),
                type: "GATEPASS_CREDIT"
            }
        ]
    };
    farmerDatabase["GW-1002"] = {
        growerCode: "GW-1002",
        pin: "5678",
        farmerName: "Runyararo Tongogara",
        farmerGroup: "The Huletts Sunsweet® Reserve",
        location: "Mwenezi District",
        balanceTati: 840.50,
        receiptLedger: [
            {
                gatepassId: "GP-88104",
                growerCode: "GW-1002",
                farmerName: "Runyararo Tongogara",
                farmerGroup: "The Huletts Sunsweet® Reserve",
                bundleWeightTons: 5.5,
                usdValuation: "$467.50 USD",
                tatiMinted: "+5.50 TATI",
                location: "Mwenezi District Gate",
                timestamp: new Date(Date.now() - 7200000).toLocaleTimeString(),
                type: "GATEPASS_CREDIT"
            }
        ]
    };

    // Investor Seed Data
    investorDatabase["INV-2001"] = {
        investorId: "INV-2001",
        email: "investor@tati.com",
        pin: "1234",
        investorName: "Lowveld Agribusiness Capital",
        usdBalance: 15000.00,
        tatiBalance: 250.00,
        transactionLedger: [
            {
                txId: "TX-9901",
                investorId: "INV-2001",
                type: "DEPOSIT",
                amountUsd: 15000.00,
                amountTati: 0.00,
                paymentGateway: "Stripe",
                status: "COMPLETED",
                timestamp: new Date(Date.now() - 14400000).toLocaleTimeString()
            }
        ]
    };
}

initDb();

// ============================================================================
// 1. GLOBAL RESERVE & TREASURY STATE ENGINE
// ============================================================================
const ORIGINAL_BASELINE_FLOOR = 85.00;

let sovereignBacking = {
    symbol: "🌳 Baobab",
    bankName: "TATI BANK",
    subtitle: "TONGAAT HULETT ZIMBABWE",
    sugarcaneReservesTons: 176470.58,
    ratePerTonneUsd: ORIGINAL_BASELINE_FLOOR,
    necessityReservesUsd: 15000000.00,
    circulatingSupplyTati: 12000000.00,
    collateralRatio: 100.0
};

let currentTatiPrice = sovereignBacking.ratePerTonneUsd;
let isMaintenanceMode = false;
let maintenanceCycleCount = 0;

// Live FX Exchange Rates
let fxRates = {
    USD: 85.00,
    EUR: 78.20,
    GBP: 66.30,
    ZAR: 1547.00,
    ZWG: 2278.00
};

const priceHistory = [];
const maxHistoryLength = 20;
const now = new Date();

for (let i = maxHistoryLength - 1; i >= 0; i--) {
    const timeLabel = new Date(now.getTime() - i * 3000).toLocaleTimeString();
    priceHistory.push({
        time: timeLabel,
        price: 85.00
    });
}

// ============================================================================
// 2. MULTI-TENANT FARMER & INVESTOR DATABASE HELPERS
// ============================================================================
const phoneToGrowerMap = {
    '+263771112233': 'GW-1001',
    '+263774445566': 'GW-1002'
};

async function getOrCreateFarmer(growerCode) {
    const code = growerCode.toUpperCase().trim();
    if (!farmerDatabase[code]) {
        farmerDatabase[code] = {
            growerCode: code,
            pin: "0000",
            farmerName: `Outgrower ${code}`,
            farmerGroup: "The Huletts Sunsweet® Reserve",
            location: "Lowveld Mill Area",
            balanceTati: 0.00,
            receiptLedger: []
        };
        await saveFarmerDb(farmerDatabase[code]);
    }
    return farmerDatabase[code];
}

// Supports lookup by Email or Investor ID case-insensitively
function findInvestorByEmail(emailOrId) {
    if (!emailOrId) return null;
    const searchStr = emailOrId.toLowerCase().trim();
    return Object.values(investorDatabase).find(
        inv => inv.email.toLowerCase() === searchStr || inv.investorId.toLowerCase() === searchStr
    ) || null;
}

// ============================================================================
// 3. DYNAMIC MARKET ENGINE
// ============================================================================
function generateMicroTick() {
    if (isMaintenanceMode) {
        maintenanceCycleCount++;
        console.log(`🛠️ [SYSTEM MAINTENANCE] Trading suspended at $${ORIGINAL_BASELINE_FLOOR.toFixed(2)} USD floor. Checking demand... (${maintenanceCycleCount})`);

        if (maintenanceCycleCount >= 4) {
            const demandRecovered = Math.random() > 0.35;
            if (demandRecovered) {
                isMaintenanceMode = false;
                maintenanceCycleCount = 0;
                currentTatiPrice = parseFloat((ORIGINAL_BASELINE_FLOOR + 0.45 + Math.random() * 0.50).toFixed(2));

                console.log(`\n=============================================================`);
                console.log(`🚀 [DEMAND RECOVERY] Export sugar demand surged!`);
                console.log(`   Resuming market operations. New Spot Price: $${currentTatiPrice} USD`);
                console.log(`=============================================================\n`);

                io.emit('maintenance_status', {
                    active: false,
                    message: `✅ Market Demand Recovered! Trading resumed at $${currentTatiPrice.toFixed(2)} USD.`,
                    price: currentTatiPrice
                });
            }
        }
        return;
    }

    const marketDrift = (Math.random() - 0.48) * 0.50;
    let newPrice = parseFloat((currentTatiPrice + marketDrift).toFixed(2));

    if (newPrice <= ORIGINAL_BASELINE_FLOOR) {
        currentTatiPrice = ORIGINAL_BASELINE_FLOOR;
        isMaintenanceMode = true;
        maintenanceCycleCount = 0;

        console.log(`\n=============================================================`);
        console.log(`⚠️ [MAINTENANCE SHUTDOWN TRIGGERED]`);
        console.log(`   Floor price reached original baseline of $${ORIGINAL_BASELINE_FLOOR.toFixed(2)} USD.`);
        console.log(`   System shutting down for maintenance until demand improves.`);
        console.log(`=============================================================\n`);

        io.emit('maintenance_status', {
            active: true,
            reason: `Spot price reached original baseline floor of $${ORIGINAL_BASELINE_FLOOR.toFixed(2)} USD. System suspended for maintenance until market demand recovers.`,
            price: ORIGINAL_BASELINE_FLOOR
        });
        return;
    }

    if (newPrice > currentTatiPrice) {
        const gainUsd = parseFloat((newPrice - currentTatiPrice).toFixed(2));
        currentTatiPrice = newPrice;

        const positiveInsight = {
            timestamp: new Date().toLocaleTimeString(),
            price: currentTatiPrice,
            gain: `+$${gainUsd.toFixed(2)} USD`,
            message: `🟢 Strong Mill Demand! Spot price appreciated naturally by +$${gainUsd.toFixed(2)} USD to $${currentTatiPrice.toFixed(2)} USD (No Buyback Required).`
        };

        io.emit('organic_insight', positiveInsight);
        console.log(`🟢 [GREEN MARKET GAIN] ${positiveInsight.message}`);
    } else {
        currentTatiPrice = newPrice;
    }

    fxRates.USD = currentTatiPrice;
    fxRates.EUR = parseFloat((currentTatiPrice * 0.92).toFixed(2));
    fxRates.GBP = parseFloat((currentTatiPrice * 0.78).toFixed(2));
    fxRates.ZAR = parseFloat((currentTatiPrice * 18.20).toFixed(2));
    fxRates.ZWG = parseFloat((currentTatiPrice * 26.80).toFixed(2));

    const tickData = {
        time: new Date().toLocaleTimeString(),
        price: currentTatiPrice
    };

    priceHistory.push(tickData);
    if (priceHistory.length > maxHistoryLength) priceHistory.shift();

    io.emit('price_tick', tickData);
    io.emit('fx_update', fxRates);
    io.emit('backing_update', sovereignBacking);
}

setInterval(generateMicroTick, 3000);

// ============================================================================
// 4. WEBSOCKET REAL-TIME EVENTS (GROWER & INVESTOR SUPPORT)
// ============================================================================
io.on('connection', (socket) => {

    // ------------------------------------------------------------------------
    // GROWER SOCKET EVENTS
    // ------------------------------------------------------------------------
    socket.on('authenticate_farmer', ({ growerCode, pin }) => {
        const code = growerCode ? growerCode.toUpperCase().trim() : "";
        const farmer = farmerDatabase[code];

        if (farmer && farmer.pin === pin) {
            socket.join(code);
            socket.emit('auth_success', {
                userType: 'GROWER',
                growerCode: farmer.growerCode,
                farmerName: farmer.farmerName,
                farmerGroup: farmer.farmerGroup,
                location: farmer.location,
                balanceTati: farmer.balanceTati,
                bankName: sovereignBacking.bankName,
                subtitle: sovereignBacking.subtitle
            });

            socket.emit('receipt_history', farmer.receiptLedger);
            socket.emit('price_history', priceHistory);
            socket.emit('fx_update', fxRates);
            socket.emit('backing_update', sovereignBacking);

            if (isMaintenanceMode) {
                socket.emit('maintenance_status', {
                    active: true,
                    reason: `Spot price reached original baseline floor of $${ORIGINAL_BASELINE_FLOOR.toFixed(2)} USD. System suspended for maintenance until market demand recovers.`,
                    price: ORIGINAL_BASELINE_FLOOR
                });
            }
        } else {
            socket.emit('auth_error', "Invalid Grower Code or PIN combination.");
        }
    });

    socket.on('register_farmer', async (data) => {
        const { farmerName, pin, farmerGroup, location } = data;

        if (!farmerName || !pin || pin.toString().length !== 4) {
            return socket.emit('auth_error', "Full name and a valid 4-digit PIN are required.");
        }

        let growerCode;
        let uniqueFound = false;
        while (!uniqueFound) {
            const randomId = Math.floor(1000 + Math.random() * 9000);
            growerCode = `GW-${randomId}`;
            if (!farmerDatabase[growerCode]) uniqueFound = true;
        }

        const newFarmer = {
            growerCode,
            pin: pin.toString().trim(),
            farmerName: farmerName.trim(),
            farmerGroup: farmerGroup ? farmerGroup.trim() : "The Huletts Sunsweet® Reserve",
            location: location ? location.trim() : "Lowveld Region",
            balanceTati: 0.00,
            receiptLedger: []
        };

        farmerDatabase[growerCode] = newFarmer;
        await saveFarmerDb(newFarmer);

        socket.join(growerCode);
        socket.emit('auth_success', {
            userType: 'GROWER',
            growerCode: newFarmer.growerCode,
            farmerName: newFarmer.farmerName,
            farmerGroup: newFarmer.farmerGroup,
            location: newFarmer.location,
            balanceTati: newFarmer.balanceTati,
            bankName: sovereignBacking.bankName,
            subtitle: sovereignBacking.subtitle
        });

        socket.emit('receipt_history', newFarmer.receiptLedger);
        socket.emit('price_history', priceHistory);
        socket.emit('fx_update', fxRates);
        socket.emit('backing_update', sovereignBacking);

        console.log(`👤 [NEW FARMER REGISTERED] ${newFarmer.farmerName} (${newFarmer.growerCode})`);
    });

    // ------------------------------------------------------------------------
    // INVESTOR SOCKET EVENTS
    // ------------------------------------------------------------------------
    socket.on('authenticate_investor', ({ email, pin }) => {
        const investor = findInvestorByEmail(email);

        if (investor && investor.pin.toString().trim() === pin.toString().trim()) {
            socket.join(investor.investorId);
            socket.emit('investor_auth_success', {
                userType: 'INVESTOR',
                investorId: investor.investorId,
                email: investor.email,
                investorName: investor.investorName,
                usdBalance: investor.usdBalance,
                tatiBalance: investor.tatiBalance,
                bankName: sovereignBacking.bankName,
                subtitle: sovereignBacking.subtitle
            });

            socket.emit('investor_tx_history', investor.transactionLedger);
            socket.emit('price_history', priceHistory);
            socket.emit('fx_update', fxRates);
            socket.emit('backing_update', sovereignBacking);
        } else {
            socket.emit('auth_error', "Invalid Investor email or PIN.");
        }
    });

    socket.on('send_message', (data) => {
        io.emit('receive_message', {
            sender: data.farmerName || data.investorName || data.growerCode || "Anonymous",
            farmerGroup: data.farmerGroup || data.userType || "Member",
            text: data.text,
            timestamp: new Date().toLocaleTimeString()
        });
    });
});

// ============================================================================
// 5. REST & TELECOM API ENDPOINTS (GROWER & INVESTOR BRANCHES)
// ============================================================================

// ----------------------------------------------------------------------------
// GROWER REST ROUTES
// ----------------------------------------------------------------------------
app.post('/api/auth/register', async (req, res) => {
    const { farmerName, pin, farmerGroup, location, preferredCode } = req.body;

    if (!farmerName || !pin || pin.toString().length !== 4) {
        return res.status(400).json({
            success: false,
            error: "Full name and a valid 4-digit PIN are required."
        });
    }

    let growerCode = preferredCode ? preferredCode.toUpperCase().trim() : '';

    if (!growerCode) {
        let uniqueFound = false;
        while (!uniqueFound) {
            const randomId = Math.floor(1000 + Math.random() * 9000);
            growerCode = `GW-${randomId}`;
            if (!farmerDatabase[growerCode]) {
                uniqueFound = true;
            }
        }
    } else if (farmerDatabase[growerCode]) {
        return res.status(409).json({
            success: false,
            error: `Grower Code '${growerCode}' is already registered.`
        });
    }

    const newFarmer = {
        growerCode: growerCode,
        pin: pin.toString().trim(),
        farmerName: farmerName.trim(),
        farmerGroup: farmerGroup ? farmerGroup.trim() : "The Huletts Sunsweet® Reserve",
        location: location ? location.trim() : "Lowveld Sugarcane Belt",
        balanceTati: 0.00,
        receiptLedger: []
    };

    farmerDatabase[growerCode] = newFarmer;
    await saveFarmerDb(newFarmer);

    console.log(`👤 [NEW FARMER REGISTERED REST] ${newFarmer.farmerName} (${newFarmer.growerCode})`);

    return res.status(201).json({
        success: true,
        message: "Account created successfully!",
        farmer: {
            growerCode: newFarmer.growerCode,
            farmerName: newFarmer.farmerName,
            farmerGroup: newFarmer.farmerGroup,
            location: newFarmer.location,
            balanceTati: newFarmer.balanceTati
        }
    });
});

app.post('/api/auth/login', (req, res) => {
    const { growerCode, pin } = req.body;
    const code = growerCode ? growerCode.toUpperCase().trim() : "";
    const farmer = farmerDatabase[code];

    if (farmer && farmer.pin === pin) {
        return res.json({
            success: true,
            userType: "GROWER",
            farmer: {
                growerCode: farmer.growerCode,
                farmerName: farmer.farmerName,
                farmerGroup: farmer.farmerGroup,
                location: farmer.location,
                balanceTati: farmer.balanceTati
            }
        });
    }
    res.status(401).json({ success: false, error: "Invalid credentials" });
});

app.post('/api/admin/approve-gatepass', async (req, res) => {
    if (isMaintenanceMode) {
        return res.status(503).json({ success: false, error: "System is currently in maintenance mode until market demand recovers." });
    }

    const { gatepassId, growerCode, bundleWeightTons, location } = req.body;
    const tons = parseFloat(bundleWeightTons);

    if (!growerCode || isNaN(tons) || tons <= 0) {
        return res.status(400).json({ success: false, error: "Invalid Grower Code or bundle tonnage." });
    }

    const farmer = await getOrCreateFarmer(growerCode);
    const addedValueUsd = tons * currentTatiPrice;

    farmer.balanceTati += tons;
    sovereignBacking.sugarcaneReservesTons += tons;
    sovereignBacking.necessityReservesUsd += addedValueUsd;
    sovereignBacking.circulatingSupplyTati += tons;

    const receipt = {
        gatepassId: gatepassId || `GP-${Math.floor(100000 + Math.random() * 900000)}`,
        growerCode: farmer.growerCode,
        farmerName: farmer.farmerName,
        farmerGroup: farmer.farmerGroup,
        bundleWeightTons: tons,
        usdValuation: `$${addedValueUsd.toFixed(2)} USD`,
        tatiMinted: `+${tons.toFixed(2)} TATI`,
        location: location || "Triangle Mill Gate 1",
        timestamp: new Date().toLocaleTimeString(),
        type: "GATEPASS_CREDIT"
    };

    farmer.receiptLedger.unshift(receipt);

    await saveFarmerDb(farmer);
    await saveReceiptDb(receipt);

    io.to(farmer.growerCode).emit('balance_update', { balanceTati: farmer.balanceTati });
    io.to(farmer.growerCode).emit('new_receipt', receipt);
    io.emit('backing_update', sovereignBacking);

    res.json({
        success: true,
        gatepass: receipt,
        farmerName: farmer.farmerName,
        farmerGroup: farmer.farmerGroup,
        newBalance: farmer.balanceTati
    });
});

app.post('/api/client/execute-payment', async (req, res) => {
    if (isMaintenanceMode) {
        return res.status(503).json({ success: false, error: "System in maintenance mode. Settlements suspended." });
    }

    const { growerCode, recipient, amountTati, targetAsset } = req.body;
    const code = growerCode ? growerCode.toUpperCase().trim() : "";
    const farmer = farmerDatabase[code];
    const amt = parseFloat(amountTati);

    if (!farmer) return res.status(404).json({ success: false, error: "Farmer account not found" });
    if (isNaN(amt) || amt <= 0 || amt > farmer.balanceTati) {
        return res.status(400).json({ success: false, error: "Invalid payment amount or insufficient balance" });
    }

    farmer.balanceTati -= amt;
    const rate = fxRates[targetAsset] || currentTatiPrice;
    const payoutAmount = (amt * rate).toFixed(2);

    const paymentRecord = {
        gatepassId: `PAY-${Math.floor(100000 + Math.random() * 900000)}`,
        growerCode: farmer.growerCode,
        farmerName: recipient || "External Vendor",
        farmerGroup: "Settlement Desk",
        bundleWeightTons: 0,
        usdValuation: `$${payoutAmount} ${targetAsset}`,
        tatiMinted: `-${amt.toFixed(2)} TATI`,
        location: "Bank Wire / Settlement Desk",
        timestamp: new Date().toLocaleTimeString(),
        type: "PAYMENT_DEBIT"
    };

    farmer.receiptLedger.unshift(paymentRecord);

    await saveFarmerDb(farmer);
    await saveReceiptDb(paymentRecord);

    io.to(farmer.growerCode).emit('balance_update', { balanceTati: farmer.balanceTati });
    io.to(farmer.growerCode).emit('new_receipt', paymentRecord);

    res.json({ success: true, paymentRecord, newBalance: farmer.balanceTati });
});

// ----------------------------------------------------------------------------
// INVESTOR REST ROUTES (REGISTER, LOGIN, DEPOSIT, TRADE)
// ----------------------------------------------------------------------------
app.post('/api/investor/register', async (req, res) => {
    try {
        const { email, pin, investorName } = req.body;

        if (!email || !pin || pin.toString().length !== 4 || !investorName) {
            return res.status(400).json({
                success: false,
                error: "Valid Email, Full Name, and a 4-digit PIN are required."
            });
        }

        if (findInvestorByEmail(email)) {
            return res.status(409).json({ success: false, error: "An investor with this email or account already exists." });
        }

        const randomId = Math.floor(2000 + Math.random() * 8000);
        const investorId = `INV-${randomId}`;

        const newInvestor = {
            investorId,
            email: email.toLowerCase().trim(),
            pin: pin.toString().trim(),
            investorName: investorName.trim(),
            usdBalance: 0.00,
            tatiBalance: 0.00,
            transactionLedger: []
        };

        investorDatabase[investorId] = newInvestor;
        await saveInvestorDb(newInvestor);

        return res.status(201).json({
            success: true,
            message: "Investor account created successfully!",
            investor: {
                investorId: newInvestor.investorId,
                email: newInvestor.email,
                investorName: newInvestor.investorName,
                usdBalance: newInvestor.usdBalance,
                tatiBalance: newInvestor.tatiBalance
            }
        });
    } catch (err) {
        console.error('❌ Investor Registration Error:', err.message);
        res.status(500).json({ success: false, error: "Internal Server Error" });
    }
});

app.post('/api/investor/login', (req, res) => {
    const { email, pin } = req.body;
    const investor = findInvestorByEmail(email);

    if (investor && investor.pin.toString().trim() === pin.toString().trim()) {
        return res.json({
            success: true,
            userType: "INVESTOR",
            investor: {
                investorId: investor.investorId,
                email: investor.email,
                investorName: investor.investorName,
                usdBalance: investor.usdBalance,
                tatiBalance: investor.tatiBalance
            }
        });
    }
    res.status(401).json({ success: false, error: "Invalid investor email or PIN." });
});

app.post('/api/investor/deposit', async (req, res) => {
    const { investorId, amountUsd, paymentGateway } = req.body;
    const investor = investorDatabase[investorId] || findInvestorByEmail(investorId);
    const amt = parseFloat(amountUsd);

    if (!investor) return res.status(404).json({ success: false, error: "Investor not found." });
    if (isNaN(amt) || amt <= 0) return res.status(400).json({ success: false, error: "Invalid deposit amount." });

    investor.usdBalance += amt;

    const tx = {
        txId: `TX-${Math.floor(1000 + Math.random() * 9000)}`,
        investorId: investor.investorId,
        type: "DEPOSIT",
        amountUsd: amt,
        amountTati: 0.00,
        paymentGateway: paymentGateway || "Stripe",
        status: "COMPLETED",
        timestamp: new Date().toLocaleTimeString()
    };

    investor.transactionLedger.unshift(tx);
    await saveInvestorDb(investor);
    await saveInvestorTxDb(tx);

    io.to(investor.investorId).emit('investor_balance_update', {
        usdBalance: investor.usdBalance,
        tatiBalance: investor.tatiBalance
    });
    io.to(investor.investorId).emit('new_investor_tx', tx);

    res.json({ success: true, tx, newUsdBalance: investor.usdBalance });
});

app.post('/api/investor/trade', async (req, res) => {
    if (isMaintenanceMode) {
        return res.status(503).json({ success: false, error: "Trading suspended while system is in maintenance mode." });
    }

    const { investorId, action, amountTati } = req.body; // action: 'BUY' or 'SELL'
    const investor = investorDatabase[investorId] || findInvestorByEmail(investorId);
    const amt = parseFloat(amountTati);

    if (!investor) return res.status(404).json({ success: false, error: "Investor account not found." });
    if (isNaN(amt) || amt <= 0) return res.status(400).json({ success: false, error: "Invalid TATI amount." });

    const costUsd = parseFloat((amt * currentTatiPrice).toFixed(2));

    if (action === 'BUY') {
        if (investor.usdBalance < costUsd) {
            return res.status(400).json({ success: false, error: "Insufficient USD funds for purchase." });
        }
        investor.usdBalance -= costUsd;
        investor.tatiBalance += amt;
    } else if (action === 'SELL') {
        if (investor.tatiBalance < amt) {
            return res.status(400).json({ success: false, error: "Insufficient TATI balance to sell." });
        }
        investor.tatiBalance -= amt;
        investor.usdBalance += costUsd;
    } else {
        return res.status(400).json({ success: false, error: "Invalid action type. Must be BUY or SELL." });
    }

    const tx = {
        txId: `TX-${Math.floor(1000 + Math.random() * 9000)}`,
        investorId: investor.investorId,
        type: action === 'BUY' ? 'TRADE_BUY' : 'TRADE_SELL',
        amountUsd: costUsd,
        amountTati: amt,
        paymentGateway: "Order Book Engine",
        status: "COMPLETED",
        timestamp: new Date().toLocaleTimeString()
    };

    investor.transactionLedger.unshift(tx);
    await saveInvestorDb(investor);
    await saveInvestorTxDb(tx);

    io.to(investor.investorId).emit('investor_balance_update', {
        usdBalance: investor.usdBalance,
        tatiBalance: investor.tatiBalance
    });
    io.to(investor.investorId).emit('new_investor_tx', tx);

    res.json({
        success: true,
        action,
        costUsd,
        amountTati: amt,
        newUsdBalance: investor.usdBalance,
        newTatiBalance: investor.tatiBalance
    });
});

// ----------------------------------------------------------------------------
// GLOBAL SYSTEM STATE ROUTE
// ----------------------------------------------------------------------------
app.get('/api/state', (req, res) => {
    res.json({
        success: true,
        currentTatiPrice,
        isMaintenanceMode,
        sovereignBacking,
        fxRates,
        priceHistory
    });
});

// ============================================================================
// SERVER STARTUP LISTENER
// ============================================================================
server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});