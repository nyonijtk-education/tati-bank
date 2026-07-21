require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

let PORT = parseInt(process.env.PORT, 10) || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// ============================================================================
// 1. GLOBAL RESERVE & TREASURY STATE ENGINE
// ============================================================================
const ORIGINAL_BASELINE_FLOOR = 85.00;

let sovereignBacking = {
    symbol: "🌳 Baobab",
    bankName: "TATI Bank Live Market and Reserve Desk",
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
// 2. MULTI-TENANT FARMER DATABASE
// ============================================================================
const farmerDatabase = {
    "GW-1001": {
        growerCode: "GW-1001",
        pin: "1234",
        farmerName: "Tatenda Nyoni",
        farmerGroup: "Mkwasine Outgrowers Co-operative",
        location: "Triangle Mill Section 4",
        balanceTati: 1250.00,
        receiptLedger: [
            {
                gatepassId: "GP-88201",
                growerCode: "GW-1001",
                farmerName: "Tatenda Nyoni",
                farmerGroup: "Mkwasine Outgrowers Co-operative",
                bundleWeightTons: 6.2,
                usdValuation: "$527.00 USD",
                tatiMinted: "+6.20 TATI",
                location: "Triangle Mill Gate 1",
                timestamp: new Date(Date.now() - 3600000).toLocaleTimeString(),
                type: "GATEPASS_CREDIT"
            }
        ]
    },
    "GW-1002": {
        growerCode: "GW-1002",
        pin: "5678",
        farmerName: "Simba Zvobgo",
        farmerGroup: "Hippo Valley Farmers Group",
        location: "Hippo Valley Section 9",
        balanceTati: 840.50,
        receiptLedger: [
            {
                gatepassId: "GP-88104",
                growerCode: "GW-1002",
                farmerName: "Simba Zvobgo",
                farmerGroup: "Hippo Valley Farmers Group",
                bundleWeightTons: 5.5,
                usdValuation: "$467.50 USD",
                tatiMinted: "+5.50 TATI",
                location: "Hippo Valley Gate 2",
                timestamp: new Date(Date.now() - 7200000).toLocaleTimeString(),
                type: "GATEPASS_CREDIT"
            }
        ]
    }
};

const phoneToGrowerMap = {
    '+263771112233': 'GW-1001',
    '+263774445566': 'GW-1002'
};

function getOrCreateFarmer(growerCode) {
    const code = growerCode.toUpperCase().trim();
    if (!farmerDatabase[code]) {
        farmerDatabase[code] = {
            growerCode: code,
            pin: "0000",
            farmerName: `Outgrower ${code}`,
            farmerGroup: "Lowveld Sugarcane Syndicate",
            location: "Lowveld Mill Area",
            balanceTati: 0.00,
            receiptLedger: []
        };
    }
    return farmerDatabase[code];
}

// ============================================================================
// 3. DYNAMIC MARKET ENGINE (APPRECIATION, INSIGHTS & MAINTENANCE SHUTDOWN)
// ============================================================================
function generateMicroTick() {
    // ------------------------------------------------------------------------
    // A. MAINTENANCE SHUTDOWN HANDLER & DEMAND RECOVERY POLLING
    // ------------------------------------------------------------------------
    if (isMaintenanceMode) {
        maintenanceCycleCount++;
        console.log(`🛠️ [SYSTEM MAINTENANCE] Trading suspended at $${ORIGINAL_BASELINE_FLOOR.toFixed(2)} USD floor. Checking demand... (${maintenanceCycleCount})`);

        // Check for organic demand recovery every 4 cycles (12 seconds)
        if (maintenanceCycleCount >= 4) {
            const demandRecovered = Math.random() > 0.35; // 65% recovery chance
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
        return; // Halt normal tick processing while in maintenance
    }

    // ------------------------------------------------------------------------
    // B. DYNAMIC PRICE FLUCTUATION ENGINE (APPRECIATION / DEPRECIATION)
    // ------------------------------------------------------------------------
    const marketDrift = (Math.random() - 0.48) * 0.50; // Dynamic market movement
    let newPrice = parseFloat((currentTatiPrice + marketDrift).toFixed(2));

    // ------------------------------------------------------------------------
    // C. CRITICAL MAINTENANCE SHUTDOWN TRIGGER (At Baseline $85.00 USD)
    // ------------------------------------------------------------------------
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

    // ------------------------------------------------------------------------
    // D. GREEN POSITIVE INSIGHT (Organic Price Appreciation without Buyback)
    // ------------------------------------------------------------------------
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
        // Price depreciated slightly above the $85.00 floor
        currentTatiPrice = newPrice;
    }

    // Update live FX Rates
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

    // Broadcast live metrics
    io.emit('price_tick', tickData);
    io.emit('fx_update', fxRates);
    io.emit('backing_update', sovereignBacking);
}

setInterval(generateMicroTick, 3000);

// ============================================================================
// 4. WEBSOCKET ISOLATED PRIVATE ROOMS
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
                balanceTati: farmer.balanceTati
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

app.post('/api/admin/approve-gatepass', (req, res) => {
    if (isMaintenanceMode) {
        return res.status(503).json({ success: false, error: "System is currently in maintenance mode until market demand recovers." });
    }

    const { gatepassId, growerCode, bundleWeightTons, location } = req.body;
    const tons = parseFloat(bundleWeightTons);

    if (!growerCode || isNaN(tons) || tons <= 0) {
        return res.status(400).json({ success: false, error: "Invalid Grower Code or bundle tonnage." });
    }

    const farmer = getOrCreateFarmer(growerCode);
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

app.post('/api/client/execute-payment', (req, res) => {
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

    io.to(farmer.growerCode).emit('balance_update', { balanceTati: farmer.balanceTati });
    io.to(farmer.growerCode).emit('new_receipt', paymentRecord);

    res.json({ success: true, paymentRecord, newBalance: farmer.balanceTati });
});

app.post('/api/ussd', (req, res) => {
    const { phoneNumber, text } = req.body;
    const growerCode = phoneToGrowerMap[phoneNumber] || 'GW-1001';
    const farmer = farmerDatabase[growerCode];

    let response = '';
    const inputs = text ? text.split('*') : [];

    if (isMaintenanceMode) {
        response = `END 🛠️ TATI Bank Maintenance Mode
System suspended as spot price touched baseline $85.00 USD floor.
Service will automatically resume when sugarcane market demand recovers.`;
        res.set('Content-Type', 'text/plain');
        return res.send(response);
    }

    if (text === '') {
        response = `CON 🌳 TATI Bank Mobile
Welcome ${farmer.farmerName.split(' ')[0]}
1. Check Balance
2. Last Gatepass Receipt
3. Transfer TATI
4. Sugarcane Spot Rate
0. Exit`;
    } else if (text === '1') {
        response = `CON Enter your 4-digit PIN:`;
    } else if (inputs.length === 2 && inputs[0] === '1') {
        const pinInput = inputs[1];
        if (pinInput === farmer.pin) {
            const usdVal = (farmer.balanceTati * currentTatiPrice).toFixed(2);
            response = `END 🏛️ TATI Bank Balance
Farmer: ${farmer.farmerName}
Code: ${farmer.growerCode}
Balance: ${farmer.balanceTati.toLocaleString()} TATI
Est Value: $${usdVal} USD`;
        } else {
            response = `END ❌ Invalid PIN. Access Denied.`;
        }
    } else if (text === '4') {
        response = `END 📈 TATI Spot Valuation
1 TATI = 1 Tonne Sugarcane
Current Spot: $${currentTatiPrice.toFixed(2)} USD
1 TATI = ${fxRates.ZWG.toFixed(2)} ZWG
1 TATI = ${fxRates.ZAR.toFixed(2)} ZAR`;
    } else {
        response = `END Thank you for using TATI Bank.`;
    }

    res.set('Content-Type', 'text/plain');
    res.send(response);
});

// ============================================================================
// 6. SHUTDOWN & PORT ENGINE
// ============================================================================
const shutdown = () => {
    console.log('\n🌳 Gracefully shutting down TATI Bank server...');
    server.close(() => {
        console.log('✅ Port released successfully.');
        process.exit(0);
    });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

function startServer(portToTry) {
    const instance = server.listen(portToTry, () => {
        console.log(`
=============================================================
🌳 TATI BANK SERVER ENGINE ONLINE
=============================================================
* Core Server Port : http://localhost:${portToTry}
* Dynamic Price    : Active (Appreciation Green Insights Enabled)
* Maintenance Mode : Automatic Shutdown at $85.00 USD Floor
=============================================================
        `);
    });

    instance.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.log(`⚠️  Port ${portToTry} occupied. Switching to port ${portToTry + 1}...`);
            startServer(portToTry + 1);
        } else {
            console.error('❌ Startup error:', err);
        }
    });
}

startServer(PORT);