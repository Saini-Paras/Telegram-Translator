const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const readline = require('readline');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '.env') });

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const apiId = parseInt(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH;

if (!apiId || !apiHash || isNaN(apiId)) {
    console.error(`
❌ ERROR: Invalid or missing API credentials.
Please open backend/.env and add your TELEGRAM_API_ID and TELEGRAM_API_HASH.
Get these from https://my.telegram.org/
    `);
    process.exit(1);
}

const stringSession = new StringSession(""); // Empty string for a new session

(async () => {
    console.log('Generating new Telegram MTProto session...');

    const client = new TelegramClient(stringSession, apiId, apiHash, {
        connectionRetries: 5,
    });

    await client.start({
        phoneNumber: async () => new Promise((resolve) => rl.question("Enter your phone number (e.g. +1234567890): ", resolve)),
        password: async () => new Promise((resolve) => rl.question("Enter your password (if you have 2FA enabled): ", resolve)),
        phoneCode: async () => new Promise((resolve) => rl.question("Enter the code you received on Telegram: ", resolve)),
        onError: (err) => console.log(err),
    });

    console.log("\n✅ Successfully connected to Telegram!");
    const sessionString = client.session.save();

    console.log("\n=============================================");
    console.log("Here is your TELEGRAM_SESSION string:");
    console.log(sessionString);
    console.log("=============================================\n");

    console.log("Please copy the string above and paste it into your backend/.env as TELEGRAM_SESSION=...");

    await client.disconnect();
    process.exit(0);
})();
