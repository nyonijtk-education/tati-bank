/**
 * TATI Bank - Feature Phone USSD Simulator (*263*8284#)
 * Usage: node ussd-cli.js
 */

const readline = require('readline');
const http = require('http');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const PHONE_NUMBER = '+263771112233'; // Default test phone for Tatenda Nyoni
const SERVICE_CODE = '*263*8284#';
const SESSION_ID = 'SESS_' + Math.floor(Math.random() * 899999 + 100000);

let ussdState = '';

console.clear();
console.log(`
📱 Nokia 3310 - Feature Phone Screen Simulator
===================================================
Dialing ${SERVICE_CODE} (TATI Bank USSD)...
Target Phone: ${PHONE_NUMBER} (Tatenda Nyoni)
===================================================
`);

function sendUssdRequest(userText) {
    const postData = JSON.stringify({
        sessionId: SESSION_ID,
        serviceCode: SERVICE_CODE,
        phoneNumber: PHONE_NUMBER,
        text: userText
    });

    const options = {
        hostname: 'localhost',
        port: process.env.PORT || 3003,
        path: '/api/ussd',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
        }
    };

    const req = http.request(options, (res) => {
        let responseText = '';
        res.on('data', (chunk) => responseText += chunk);
        res.on('end', () => {
            const isContinue = responseText.startsWith('CON ');
            const screenMessage = responseText.replace(/^(CON|END)\s?/, '');

            console.log('\n+-------------------------------------------------+');
            screenMessage.split('\n').forEach(line => console.log(`| ${line.padEnd(47)} |`));
            console.log('+-------------------------------------------------+\n');

            if (isContinue) {
                rl.question('Input Reply > ', (reply) => {
                    ussdState = ussdState ? `${ussdState}*${reply.trim()}` : reply.trim();
                    sendUssdRequest(ussdState);
                });
            } else {
                console.log('📲 Call ended by network.\n');
                rl.close();
                process.exit(0);
            }
        });
    });

    req.on('error', (e) => {
        console.log(`\n❌ Network Error: Is server.js running? (${e.message})\n`);
        process.exit(1);
    });

    req.write(postData);
    req.end();
}
// Start USSD Session
sendUssdRequest('');
 