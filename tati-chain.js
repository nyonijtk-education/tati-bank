const crypto = require('crypto');
const express = require('express');

const app = express();
const PORT = 3000;

app.use(express.json());

// ============================================================================
// 1. BLOCK DATA STRUCTURE
// ============================================================================
class Block {
    constructor(index, timestamp, transactions, previousHash = '') {
        this.index = index;
        this.timestamp = timestamp;
        this.transactions = transactions;
        this.previousHash = previousHash;
        this.hash = this.calculateHash();
    }

    // Cryptographic Hash Function: Creates an immutable SHA-256 footprint
    calculateHash() {
        const payload = this.index + this.previousHash + this.timestamp + JSON.stringify(this.transactions);
        return crypto.createHash('sha256').update(payload).digest('hex');
    }
}

// ============================================================================
// 2. SOVEREIGN TATI LEDGER & STATE ENGINE
// ============================================================================
class TatiSovereignChain {
    constructor() {
        this.chain = [this.createGenesisBlock()];
        this.mempool = []; // Pending unconfirmed transactions
        
        // Initial Native Mint: 10,000,000 Native TATI Coins issued to Main Treasury
        this.balances = {
            "TREASURY": 10000000
        };
    }

    // Genesis Block: The origin block of the TATI network
    createGenesisBlock() {
        const genesisTx = [{ from: "GENESIS_MINT", to: "TREASURY", amount: 10000000, timestamp: new Date().toISOString() }];
        return new Block(0, new Date().toISOString(), genesisTx, "0000000000000000000000000000000000000000000000000000000000000000");
    }

    getLatestBlock() {
        return this.chain[this.chain.length - 1];
    }

    getBalance(address) {
        return this.balances[address] || 0;
    }

    // Add transaction to the pending mempool
    submitTransaction(from, to, amount) {
        const senderBalance = this.getBalance(from);
        
        if (from !== "GENESIS_MINT" && senderBalance < amount) {
            throw new Error(`Insufficient funds: ${from} holds ${senderBalance} TATI, attempted transfer of ${amount} TATI`);
        }

        const tx = {
            from,
            to,
            amount: parseFloat(amount),
            timestamp: new Date().toISOString(),
            txId: crypto.randomBytes(16).toString('hex')
        };

        this.mempool.push(tx);
        return tx;
    }

    // Seal mempool transactions into a new immutable Block
    produceBlock(validatorId = "BANK_VALIDATOR_NODE_01") {
        if (this.mempool.length === 0) {
            throw new Error("No pending transactions in mempool to seal into a block.");
        }

        // Apply state transitions (update balances)
        for (const tx of this.mempool) {
            if (tx.from !== "GENESIS_MINT") {
                this.balances[tx.from] -= tx.amount;
            }
            this.balances[tx.to] = (this.balances[tx.to] || 0) + tx.amount;
        }

        // Create, hash, and link new block
        const newBlock = new Block(
            this.chain.length,
            new Date().toISOString(),
            [...this.mempool],
            this.getLatestBlock().hash
        );

        this.chain.push(newBlock);
        this.mempool = []; // Clear mempool
        return newBlock;
    }

    // Verify cryptographic integrity of the entire chain
    verifyLedgerIntegrity() {
        for (let i = 1; i < this.chain.length; i++) {
            const currentBlock = this.chain[i];
            const previousBlock = this.chain[i - 1];

            // 1. Verify Hash Integrity
            if (currentBlock.hash !== currentBlock.calculateHash()) {
                return { valid: false, reason: `Block #${currentBlock.index} payload has been tampered with!` };
            }

            // 2. Verify Cryptographic Linkage
            if (currentBlock.previousHash !== previousBlock.hash) {
                return { valid: false, reason: `Block #${currentBlock.index} is disconnected from Block #${previousBlock.index}!` };
            }
        }
        return { valid: true, chainLength: this.chain.length };
    }
}

// Initialize Native Blockchain Instance
const TATI_NETWORK = new TatiSovereignChain();

// ============================================================================
// 3. HTTP RPC API ENDPOINTS
// ============================================================================

// View Full Blockchain Ledger
app.get('/rpc/chain', (req, res) => {
    res.json({
        network: "TATI-Sovereign-L1",
        blocks: TATI_NETWORK.chain.length,
        ledger: TATI_NETWORK.chain
    });
});

// Audit Account Balance
app.get('/rpc/balance/:address', (req, res) => {
    const balance = TATI_NETWORK.getBalance(req.params.address);
    res.json({ address: req.params.address, balance: `${balance} TATI` });
});

// Submit Transaction to Mempool
app.post('/rpc/transaction', (req, res) => {
    try {
        const { from, to, amount } = req.body;
        const tx = TATI_NETWORK.submitTransaction(from, to, amount);
        res.json({ success: true, message: "Transaction accepted into mempool", transaction: tx });
    } catch (err) {
        res.status(400).json({ success: false, error: err.message });
    }
});

// Produce & Seal Block (Validator Execution)
app.post('/rpc/produce-block', (req, res) => {
    try {
        const block = TATI_NETWORK.produceBlock();
        res.json({ success: true, message: "Block sealed and linked to chain", block: block });
    } catch (err) {
        res.status(400).json({ success: false, error: err.message });
    }
});

// Cryptographic Audit Verification Endpoint
app.get('/rpc/audit', (req, res) => {
    const audit = TATI_NETWORK.verifyLedgerIntegrity();
    res.json(audit);
});

app.listen(PORT, () => {
    console.log(`
  =============================================================
  🪙 NATIVE TATI LAYER-1 BLOCKCHAIN NODE RUNNING
  =============================================================
  * RPC Server: http://localhost:${PORT}
  * Genesis Allocation: 10,000,000 TATI -> 'TREASURY'
  * Cryptographic Hash: SHA-256
  =============================================================
    `);
});
