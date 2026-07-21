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

// In-Memory Database Cache (Hydrated from PostgreSQL)
const farmerDatabase = {};

// Helper: Save/Update Farmer in PostgreSQL
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

// Helper: Save Receipt/Transaction in PostgreSQL
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
        `);

        // Check if database is empty; seed initial records if so
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
        } else {
            // Load existing database into RAM cache
            console.log('🔄 Hydrating memory cache from PostgreSQL database...');
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
        }
        console.log('✅ PostgreSQL Database connected and state fully hydrated!');
    } catch (err) {
        console.error('❌ Database Initialization Error:', err.message);
        seedInitialMemoryCache();
    }
}

function seedInitialMemoryCache() {
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
// 2. MULTI-TENANT FARMER DATABASE HELPERS
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
// 4. WEBSOCKET REAL-TIME EVENTS
// ============================================================================
io.on('connection', (socket) => {

    socket.on('authenticate_farmer', ({ growerCode, pin }) => {
        const code = growerCode ? growerCode.toUpperCase().trim() : "";
        const farmer = farmerDatabase[code];

        if (farmer && farmer.pin === pin) {
            socket.join(code);
            socket.emit('auth_success', {
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

    socket.on('send_message', (data) => {
        io.emit('receive_message', {
            sender: data.farmerName || data.growerCode,
            farmerGroup: data.farmerGroup || "Outgrower",
            text: data.text,
            timestamp: new Date().toLocaleTimeString()
        });
    });
});

// ============================================================================
// 5. REST & TELECOM API ENDPOINTS
// ============================================================================

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

// USSD ROUTER
app.post('/api/ussd', async (req, res) => {
    const { phoneNumber, text } = req.body;
    const growerCode = phoneToGrowerMap[phoneNumber] || 'GW-1001';
    const farmer = farmerDatabase[growerCode];

    let response = '';
    const rawText = text || '';
    const inputs = rawText.split('*').filter(i => i.trim() !== '');

    if (isMaintenanceMode) {
        response = `END 🛠️ TATI BANK Maintenance Mode
System suspended as spot price touched baseline $85.00 USD floor.
Service will automatically resume when sugarcane market demand recovers.`;
        res.set('Content-Type', 'text/plain');
        return res.send(response);
    }

    // Main Menu
    if (inputs.length === 0) {
        response = `CON 🌳 TATI BANK Mobile
Welcome ${farmer.farmerName.split(' ')[0]}
1. Check Balance
2. Last Gatepass Receipt
3. Transfer TATI
4. Sugarcane Spot Rate
0. Exit`;
    } 
    // Option 1: Balance Flow
    else if (inputs[0] === '1') {
        if (inputs.length === 1) {
            response = `CON Enter your 4-digit PIN:`;
        } else {
            const pinInput = inputs[1];
            if (pinInput === farmer.pin) {
                const usdVal = (farmer.balanceTati * currentTatiPrice).toFixed(2);
                response = `END 🏛️ TATI BANK Balance
Farmer: ${farmer.farmerName}
Code: ${farmer.growerCode}
Balance: ${farmer.balanceTati.toLocaleString()} TATI
Est Value: $${usdVal} USD`;
            } else {
                response = `END ❌ Invalid PIN. Access Denied.`;
            }
        }
    } 
    // Option 2: Last Gatepass Receipt
    else if (inputs[0] === '2') {
        const lastReceipt = farmer.receiptLedger[0];
        if (lastReceipt) {
            response = `END 📄 Last Receipt (${lastReceipt.gatepassId})
Weight: ${lastReceipt.bundleWeightTons} Tons
Valuation: ${lastReceipt.usdValuation}
Minted: ${lastReceipt.tatiMinted}
Location: ${lastReceipt.location}`;
        } else {
            response = `END 📄 No receipt history found for ${farmer.growerCode}.`;
        }
    } 
    // Option 3: Transfer TATI Flow
    else if (inputs[0] === '3') {
        if (inputs.length === 1) {
            response = `CON Enter Recipient Grower Code (e.g. GW-1002):`;
        } else if (inputs.length === 2) {
            response = `CON Enter TATI Amount to Transfer:`;
        } else if (inputs.length === 3) {
            response = `CON Enter 4-Digit PIN to Confirm Transfer:`;
        } else if (inputs.length >= 4) {
            const recipientCode = inputs[1].toUpperCase().trim();
            const transferAmt = parseFloat(inputs[2]);
            const pinInput = inputs[3];

            if (pinInput !== farmer.pin) {
                response = `END ❌ Invalid PIN. Transfer Cancelled.`;
            } else if (isNaN(transferAmt) || transferAmt <= 0) {
                response = `END ❌ Invalid Transfer Amount.`;
            } else if (transferAmt > farmer.balanceTati) {
                response = `END ❌ Insufficient TATI Balance. Available: ${farmer.balanceTati} TATI.`;
            } else if (!farmerDatabase[recipientCode]) {
                response = `END ❌ Recipient Grower (${recipientCode}) Not Found.`;
            } else {
                const recipient = farmerDatabase[recipientCode];
                farmer.balanceTati -= transferAmt;
                recipient.balanceTati += transferAmt;

                const senderDebit = {
                    gatepassId: `TRF-${Math.floor(100000 + Math.random() * 900000)}`,
                    growerCode: farmer.growerCode,
                    farmerName: recipient.farmerName,
                    farmerGroup: recipient.farmerGroup,
                    bundleWeightTons: 0,
                    usdValuation: `$${(transferAmt * currentTatiPrice).toFixed(2)} USD`,
                    tatiMinted: `-${transferAmt.toFixed(2)} TATI`,
                    location: "USSD Peer Transfer",
                    timestamp: new Date().toLocaleTimeString(),
                    type: "PAYMENT_DEBIT"
                };

                farmer.receiptLedger.unshift(senderDebit);

                await saveFarmerDb(farmer);
                await saveFarmerDb(recipient);
                await saveReceiptDb(senderDebit);

                io.to(farmer.growerCode).emit('balance_update', { balanceTati: farmer.balanceTati });
                io.to(farmer.growerCode).emit('new_receipt', senderDebit);
                io.to(recipient.growerCode).emit('balance_update', { balanceTati: recipient.balanceTati });

                response = `END ✅ Transfer Successful!
Sent: ${transferAmt} TATI to ${recipient.farmerName} (${recipient.growerCode})
New Balance: ${farmer.balanceTati} TATI`;
            }
        }
    } 
    // Option 4: Spot Rate
    else if (inputs[0] === '4') {
        response = `END 📈 TATI Spot Valuation
1 TATI = 1 Tonne Sugarcane
Current Spot: $${currentTatiPrice.toFixed(2)} USD
1 TATI = ${fxRates.ZWG.toFixed(2)} ZWG
1 TATI = ${fxRates.ZAR.toFixed(2)} ZAR`;
    } 
    // Option 0 or default
    else {
        response = `END Thank you for using TATI BANK.`;
    }

    res.set('Content-Type', 'text/plain');
    res.send(response);
});

// ============================================================================
// 6. SHUTDOWN & AUTOMATIC PORT CLEANUP ENGINE
// ============================================================================
const shutdown = () => {
    console.log('\n🌳 Gracefully shutting down TATI BANK server...');
    server.close(() => {
        console.log('✅ Port released successfully.');
        process.exit(0);
    });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

function listen(targetPort) {
    server.listen(targetPort, '0.0.0.0', () => {
        console.log(`
=============================================================
🌳 TATI BANK SERVER ENGINE ONLINE
=============================================================
* Core Server Port : http://0.0.0.0:${targetPort}
* Subtitle         : TONGAAT HULETT ZIMBABWE
* Dynamic Price    : Active (Appreciation Green Insights Enabled)
* Maintenance Mode : Automatic Shutdown at $85.00 USD Floor
* PostgreSQL DB    : Enabled & Synchronized
=============================================================
        `);
    });
}

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.log(`⚠️ Port ${PORT} occupied. Executing fallback killall on port ${PORT}...`);
        try {
            if (process.platform === 'win32') {
                execSync(`npx kill-port ${PORT}`);
            } else {
                execSync(`lsof -ti:${PORT} | xargs kill -9`);
            }
            console.log(`✅ Cleared lingering processes on port ${PORT}. Retrying startup...`);
            setTimeout(() => listen(PORT), 800);
        } catch (e) {
            console.error(`❌ Automated fallback port clear failed: ${e.message}`);
            process.exit(1);
        }
    } else {
        console.error('❌ Startup error:', err);
    }
});

listen(PORT);