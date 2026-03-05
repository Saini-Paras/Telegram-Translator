const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const dotenv = require('dotenv');
const connectDB = require('./database/db');
const { initSocket } = require('./websocket/socket');
const { initTelegramListener, getTelegramClient, processMessage } = require('./telegram/listener');
const Message = require('./database/models/Message');
const SelectedChat = require('./database/models/SelectedChat');
const { createTopicForChat, deleteTopicForChat, isBotConfigured } = require('./telegram/botForwarder');

// Load env vars
dotenv.config();

// Connect to database
connectDB();

const app = express();
const server = http.createServer(app);

// Middleware
app.use(cors());
app.use(express.json());

// Initialize Socket.io
initSocket(server);

// Initialize Telegram Listener
initTelegramListener();

// REST API endpoint to get message history
app.get('/api/messages', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;
        const chatId = req.query.chat_id;

        const query = {};
        if (chatId) {
            query.telegram_chat_id = chatId;
        } else {
            // If no generic chatId is specified, only fetch messages from selected chats
            const selectedChats = await SelectedChat.find({}, 'telegram_chat_id');
            const selectedIds = selectedChats.map(c => c.telegram_chat_id);
            const extendedIds = [];
            for (const id of selectedIds) {
                extendedIds.push(id.toString());
                extendedIds.push(`-100${id}`);
                if (id.startsWith('-100')) {
                    extendedIds.push(id.substring(4));
                }
            }
            if (extendedIds.length > 0) {
                query.telegram_chat_id = { $in: extendedIds };
            } else {
                return res.json([]); // Return empty if no chats selected
            }
        }

        const messages = await Message.find(query)
            .sort({ timestamp: -1 })
            .skip(skip)
            .limit(limit);

        // Return messages in chronological order for frontend display
        res.json(messages.reverse());
    } catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).json({ error: 'Server Error' });
    }
});

// ──────────────────────────────────────────────
// CHAT SELECTION API
// ──────────────────────────────────────────────

// Get list of available dialogs from Telegram
app.get('/api/dialogs', async (req, res) => {
    try {
        const client = getTelegramClient();
        if (!client) return res.status(503).json({ error: 'Telegram client not ready' });

        const dialogs = await client.getDialogs({ limit: 100 });
        const formattedDialogs = dialogs.map(d => ({
            id: d.entity?.id?.toString() || d.id?.toString(),
            title: d.title || d.name || 'Unknown',
            isGroup: d.isGroup,
            isChannel: d.isChannel,
            isUser: d.isUser
        })).filter(d => d.id);

        res.json(formattedDialogs);
    } catch (error) {
        console.error('Error fetching dialogs:', error);
        res.status(500).json({ error: 'Failed to fetch dialogs' });
    }
});

// Get currently selected chats
app.get('/api/selected-chats', async (req, res) => {
    try {
        const chats = await SelectedChat.find().sort({ added_at: -1 });
        res.json(chats);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch selected chats' });
    }
});

// Add a new chat to track
app.post('/api/selected-chats', async (req, res) => {
    try {
        const { telegram_chat_id, title, type } = req.body;
        if (!telegram_chat_id) return res.status(400).json({ error: 'Chat ID required' });

        // Save to DB
        const newChat = new SelectedChat({
            telegram_chat_id: telegram_chat_id.toString(),
            title: title || 'Unknown',
            type: type || 'unknown'
        });

        // Create forum topic if bot is configured
        if (isBotConfigured()) {
            try {
                const threadId = await createTopicForChat(title || 'Unknown');
                newChat.topic_thread_id = threadId;
            } catch (topicErr) {
                console.error('Failed to create forum topic:', topicErr.message);
            }
        }

        await newChat.save();

        res.status(201).json(newChat);

        // Async trigger 1-month history fetch
        const client = getTelegramClient();
        if (client) {
            setTimeout(async () => {
                console.log(`📥 Initiating 1-month history fetch for new chat: ${title}`);
                try {
                    const dialogs = await client.getDialogs({ limit: 100 });
                    const targetDialog = dialogs.find(d =>
                        (d.entity && d.entity.id && d.entity.id.toString() === telegram_chat_id.toString()) ||
                        (d.id && d.id.toString() === telegram_chat_id.toString()) ||
                        (d.entity && d.entity.id && '-100' + d.entity.id.toString() === telegram_chat_id.toString())
                    );

                    if (targetDialog) {
                        // 1 month ago
                        const offsetDate = Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60);
                        let offsetId = 0;
                        let count = 0;

                        // Fetching in chunks
                        while (true) {
                            const history = await client.getMessages(targetDialog.entity, {
                                limit: 50,
                                offsetId: offsetId
                            });

                            if (!history || history.length === 0) break;

                            for (const msg of history) {
                                if (msg.date < offsetDate) {
                                    offsetId = -1; // Flag to exit outer loop
                                    break;
                                }
                                if (msg.message) {
                                    await processMessage(client, msg, 'en-US', true); // broadcast
                                    count++;
                                }
                            }
                            if (offsetId === -1 || history.length < 50) break;
                            offsetId = history[history.length - 1].id;
                        }
                        console.log(`✅ Finished fetching ${count} historical messages for ${title}`);
                    }
                } catch (e) {
                    console.error('History fetch for new chat failed:', e.message);
                }
            }, 1000);
        }
    } catch (error) {
        if (error.code === 11000) return res.status(400).json({ error: 'Chat already selected' });
        console.error(error);
        res.status(500).json({ error: 'Failed to add chat' });
    }
});

// Remove a selected chat
app.delete('/api/selected-chats/:id', async (req, res) => {
    try {
        const chatId = req.params.id;
        const chat = await SelectedChat.findOne({ telegram_chat_id: chatId });

        // Delete forum topic if it exists
        if (chat && chat.topic_thread_id && isBotConfigured()) {
            await deleteTopicForChat(chat.topic_thread_id);
        }

        await SelectedChat.findOneAndDelete({ telegram_chat_id: chatId });

        // Also delete cached messages for this chat to free space
        await Message.deleteMany({
            telegram_chat_id: { $in: [chatId, `-100${chatId}`, chatId.replace('-100', '')] }
        });

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to remove chat' });
    }
});

// Check if bot forwarding is configured
app.get('/api/bot-status', (req, res) => {
    res.json({ configured: isBotConfigured() });
});

// Serve frontend in production
const frontendPath = path.join(__dirname, '../frontend/dist');
app.use(express.static(frontendPath));

app.get('*', (req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
