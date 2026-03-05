const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const dotenv = require('dotenv');
const { translateText } = require('../translation/deepl');
const Message = require('../database/models/Message');
const SelectedChat = require('../database/models/SelectedChat');
const { broadcastMessage } = require('../websocket/socket');
const { forwardToTopic, isBotConfigured } = require('./botForwarder');

dotenv.config();

const apiId = parseInt(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH;
const sessionStr = (process.env.TELEGRAM_SESSION || '').trim();
const stringSession = new StringSession(sessionStr);

let telegramClient = null; // Store globally to reuse in APIs

// Helper: process a single telegram message, translate, cache, and optionally broadcast
const processMessage = async (client, msg, targetLanguage = 'en-US', shouldBroadcast = true) => {
    if (!msg || !msg.message) return null;

    const tgMessageId = msg.id;
    const chatId = msg.peerId
        ? (msg.peerId.channelId || msg.peerId.chatId || msg.peerId.userId || 'unknown')
        : 'unknown';
    const text = msg.message;
    const timestamp = new Date(msg.date * 1000);

    let username = 'Unknown User';
    try {
        const sender = await msg.getSender();
        if (sender) {
            username = sender.username
                ? `@${sender.username}`
                : `${sender.firstName || ''} ${sender.lastName || ''}`.trim();
        }
    } catch (err) { /* ignore */ }

    let cachedMessage = await Message.findOne({
        telegram_message_id: tgMessageId,
        target_language: targetLanguage,
    });

    if (!cachedMessage) {
        const translationResult = await translateText(text, targetLanguage);

        cachedMessage = new Message({
            telegram_message_id: tgMessageId,
            telegram_chat_id: chatId.toString(),
            username,
            original_text: text,
            detected_language: translationResult.detectedLanguage,
            translated_text: translationResult.translatedText,
            target_language: targetLanguage,
            timestamp,
        });

        try {
            await cachedMessage.save();
            console.log(`💬 Translated: "${text.substring(0, 50)}..." from ${username}`);
        } catch (saveErr) {
            if (saveErr.code === 11000) {
                cachedMessage = await Message.findOne({
                    telegram_message_id: tgMessageId,
                    target_language: targetLanguage,
                });
            } else {
                console.error('Save error:', saveErr.message);
            }
        }
    }

    if (shouldBroadcast && cachedMessage) {
        broadcastMessage(cachedMessage);
    }

    // Forward to forum topic if bot is configured
    if (cachedMessage && isBotConfigured()) {
        try {
            const possibleIds = [
                chatId.toString(),
                `-100${chatId.toString()}`
            ];
            const selectedChat = await SelectedChat.findOne({ telegram_chat_id: { $in: possibleIds } });
            if (selectedChat && selectedChat.topic_thread_id) {
                await forwardToTopic(
                    selectedChat.topic_thread_id,
                    cachedMessage.translated_text,
                    cachedMessage.username,
                    cachedMessage.original_text,
                    cachedMessage.detected_language
                );
            }
        } catch (fwdErr) {
            console.error('Bot forward error:', fwdErr.message);
        }
    }

    return cachedMessage;
};

const initTelegramListener = async () => {
    if (!apiId || !apiHash || isNaN(apiId)) {
        console.warn('⚠️  Telegram API credentials missing. Listener disabled.');
        return;
    }

    console.log(`🔑 API ID: ${apiId}, Session: ${sessionStr.length} chars`);

    const client = new TelegramClient(stringSession, apiId, apiHash, {
        connectionRetries: 5,
    });

    try {
        // Helper: timeout wrapper
        const withTimeout = (promise, ms, name) => {
            return Promise.race([
                promise,
                new Promise((_, reject) => setTimeout(() => reject(new Error(`${name} timed out after ${ms}ms`)), ms))
            ]);
        };
        // Use connect() for saved sessions — start() tries interactive auth
        console.log('🔄 Connecting to Telegram...');
        await client.connect();
        console.log('✅ Connected to Telegram!');

        // Test auth by fetching current user info
        console.log('⏳ Checking authorization by fetching user profile...');
        try {
            const me = await withTimeout(client.getMe(), 15000, 'getMe');
            console.log(`👤 Logged in as: ${me.firstName || ''} ${me.lastName || ''} (@${me.username || 'N/A'})`);
        } catch (authErr) {
            console.error('❌ Session is not authorized or timed out! Please run generate_session.js again.');
            console.error('Error details:', authErr.message);
            return;
        }

        // ──────────────────────────────────────────────
        // FETCH RECENT HISTORY ONLY FOR SELECTED CHATS
        // ──────────────────────────────────────────────
        console.log('📥 Fetching recent messages from Selected Chats...');
        try {
            const selectedChats = await SelectedChat.find();
            if (selectedChats.length > 0) {
                console.log('⏳ Getting dialogs to map entities...');
                const dialogs = await withTimeout(client.getDialogs({ limit: 100 }), 20000, 'getDialogs');

                for (const selected of selectedChats) {
                    // Try to find the matching dialog entity
                    const dialog = dialogs.find(d =>
                        (d.entity && d.entity.id && d.entity.id.toString() === selected.telegram_chat_id) ||
                        (d.id && d.id.toString() === selected.telegram_chat_id) ||
                        (d.entity && d.entity.id && '-100' + d.entity.id.toString() === selected.telegram_chat_id)
                    );

                    if (dialog) {
                        console.log(`  → Syncing history for ${selected.title}`);
                        try {
                            const history = await client.getMessages(dialog.entity, { limit: 30 });
                            let count = 0;
                            for (const msg of history) {
                                if (msg.message) {
                                    await processMessage(client, msg, 'en-US', false);
                                    count++;
                                }
                            }
                            console.log(`    ✅ ${count} messages from "${selected.title}"`);
                        } catch (histErr) {
                            console.error(`    ❌ "${selected.title}": ${histErr.message}`);
                        }
                    } else {
                        console.warn(`    ⚠️ Could not find dialog entity for selected chat "${selected.title}" (${selected.telegram_chat_id})`);
                    }
                }
            } else {
                console.log('   ℹ️ No chats selected yet. Use the web interface to select chats to sync.');
            }
        } catch (dialogErr) {
            console.error('⚠️  History fetch error:', dialogErr.message);
        }

        // ──────────────────────────────────────────────
        // LISTEN FOR NEW MESSAGES IN REAL-TIME
        // ──────────────────────────────────────────────
        console.log('👂 Listening for new messages...');

        client.addEventHandler(async (event) => {
            try {
                // Check if this chat is selected
                const chatId = event.message.peerId
                    ? (event.message.peerId.channelId || event.message.peerId.chatId || event.message.peerId.userId || 'unknown')
                    : 'unknown';

                // Telegram API sometimes doesn't include the -100 prefix for channels in event objects
                const possibleIds = [
                    chatId.toString(),
                    `-100${chatId.toString()}`
                ];

                const isSelected = await SelectedChat.exists({ telegram_chat_id: { $in: possibleIds } });

                if (!isSelected) {
                    return; // Ignore messages from non-selected chats
                }

                await processMessage(client, event.message, 'en-US', true);
            } catch (err) {
                console.error('Live message error:', err.message);
            }
        }, new NewMessage({}));

        telegramClient = client;

    } catch (error) {
        console.error('❌ Telegram init error:', error.message);
        console.error(error);
    }
};

const getTelegramClient = () => telegramClient;

module.exports = { initTelegramListener, getTelegramClient, processMessage };
