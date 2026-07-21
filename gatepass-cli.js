/**
 * TATI Bank - Mill Weighbridge Gatepass & Liquidity Minting Terminal
 * Usage: node gatepass-cli.js
 */

const readline = require('readline');
const http = require('http');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// Local lookup database matching server.js grower accounts
const GROWER_DB = {
    'GW-1001': { name: 'Tatenda Nyoni', group: 'Mkwasine Outgrowers Co-operative' },
    'GW-1002': { name: 'Simba Zvobgo', group: 'Hippo Valley Farmers Group' }
};

console.clear();
console.log(`
===================================================================
🌳 TATI BANK | MILL WEIGHBRIDGE GATEPASS & LIQUIDITY MINTING CLI
===================================================================
Target Mill: Lowveld Sugarcane Terminal / Triangle & Hippo Estates
Spot Valuation: 1 Tonne = 1 TATI ($85.00 USD Floor)
===================================================================
`);

function promptGatepass() {
    rl.question('📋 Enter Gatepass ID (e.g., GP-88204): ', (gatepassId) => {
        rl.question('🏷️  Enter Grower Code (e.g., GW-1001 or GW-1002): ', (growerCode) => {
            rl.question('⚖️  Enter Weighed Sugarcane Mass in Tonnes (e.g., 6.4): ', (tons) => {
                rl.question('📍 Enter Mill Drop Point (default: Triangle Mill Gate 1): ', (location) => {
                    
                    const weight = parseFloat(tons);
                    const cleanCode = growerCode.trim().toUpperCase();

                    if (!cleanCode) {
                        console.log('\n❌ ERROR: Grower Code is required. Transaction aborted.\n');
                        return promptAnother();
                    }

                    if (isNaN(weight) || weight <= 0) {
                        console.log('\n❌ ERROR: Invalid tonnage entered. Transaction aborted.\n');
                        return promptAnother();
                    }

                    const growerInfo = GROWER_DB[cleanCode] || { name: `Outgrower ${cleanCode}`, group: 'Lowveld Sugarcane Outgrowers' };
                    const cleanGatepassId = gatepassId.trim() || `GP-${Math.floor(100000 + Math.random() * 900000)}`;
                    const cleanLocation = location.trim() || "Triangle Mill Gate 1";

                    console.log(`
-------------------------------------------------------------------
⚠️  TRANSACTION SUMMARY FOR CONFIRMATION
-------------------------------------------------------------------
Gatepass ID  : ${cleanGatepassId}
Farmer Name  : ${growerInfo.name}
Farmer Group : ${growerInfo.group}
Grower Code  : ${cleanCode}
Sugarcane    : ${weight} Tonnes
Mint Value   : +${weight.toFixed(2)} TATI ($${(weight * 85).toFixed(2)} USD Floor)
Drop Point   : ${cleanLocation}
-------------------------------------------------------------------
`);

                    rl.question('❓ Confirm approval and mint liquidity to farmer? (y/n): ', (confirmAns) => {
                        if (confirmAns.trim().toLowerCase() !== 'y') {
                            console.log('\n🚫 TRANSACTION CANCELLED BY OPERATOR. No liquidity was minted.\n');
                            return promptAnother();
                        }

                        const postData = JSON.stringify({
                            gatepassId: cleanGatepassId,
                            growerCode: cleanCode,
                            bundleWeightTons: weight,
                            location: cleanLocation
                        });

                        const options = {
                            hostname: 'localhost',
                            port: process.env.PORT || 3003,
                            path: '/api/admin/approve-gatepass',
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Content-Length': Buffer.byteLength(postData)
                            }
                        };

                        console.log('\n⏳ Submitting to TATI Bank ledger...');

                        const req = http.request(options, (res) => {
                            let data = '';
                            res.on('data', (chunk) => data += chunk);
                            res.on('end', () => {
                                try {
                                    const response = JSON.parse(data);
                                    if (response.success) {
                                        console.log(`
===================================================================
✅ GATEPASS APPROVED & CREDIT MINTED SUCCESSFULLY!
-------------------------------------------------------------------
Receipt ID       : ${response.gatepass.gatepassId}
Grower Code      : ${response.gatepass.growerCode}
Farmer Name      : ${response.farmerName}
Farmer Group     : ${response.farmerGroup}
Weighed Tonnage  : ${response.gatepass.bundleWeightTons} Tonnes
USD Floor Value  : ${response.gatepass.usdValuation}
TATI Credited    : ${response.gatepass.tatiMinted}
New Balance      : ${response.newBalance.toLocaleString()} TATI
===================================================================
`);
                                    } else {
                                        console.log(`\n❌ REJECTED: ${response.error}\n`);
                                    }
                                } catch (e) {
                                    console.log('\n❌ Server response parse error.\n');
                                }
                                promptAnother();
                            });
                        });

                        req.on('error', (e) => {
                            console.log(`\n❌ Network Error: Is the server running? (${e.message})\n`);
                            promptAnother();
                        });

                        req.write(postData);
                        req.end();
                    });
                });
            });
        });
    });
}

function promptAnother() {
    rl.question('Process another Gatepass? (y/n): ', (ans) => {
        if (ans.trim().toLowerCase() === 'y') {
            console.log('\n-------------------------------------------------------------------');
            promptGatepass();
        } else {
            console.log('\nExiting Gatepass Terminal. Goodbye 🌳\n');
            rl.close();
            process.exit(0);
        }
    });
}

promptGatepass();