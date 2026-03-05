const https = require('https');
const http = require('http');

const BOT_TOKEN = process.env.TRANSLATOR_BOT_TOKEN;
const GROUP_CHAT_ID = process.env.TRANSLATOR_GROUP_ID;

/**
 * Make a Bot API request
 */
const botApiRequest = (method, params = {}) => {
    return new Promise((resolve, reject) => {
        if (!BOT_TOKEN) return reject(new Error('TRANSLATOR_BOT_TOKEN not configured'));

        const url = `https://api.telegram.org/bot${BOT_TOKEN}/${method}`;
        const data = JSON.stringify(params);

        const req = https.request(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data)
            }
        }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(body);
                    if (parsed.ok) {
                        resolve(parsed.result);
                    } else {
                        reject(new Error(`Bot API error: ${parsed.description}`));
                    }
                } catch (e) {
                    reject(new Error(`Failed to parse Bot API response: ${body}`));
                }
            });
        });

        req.on('error', reject);
        req.write(data);
        req.end();
    });
};

/**
 * Create a forum topic for a source chat
 * @returns {number} message_thread_id of the created topic
 */
const createTopicForChat = async (chatTitle) => {
    if (!GROUP_CHAT_ID) throw new Error('TRANSLATOR_GROUP_ID not configured');

    // Pick an icon color based on chat title
    const colors = [0x6FB9F0, 0xFFD67E, 0xCB86DB, 0x8EEE98, 0xFF93B2, 0xFB6F5F];
    let hash = 0;
    for (let i = 0; i < chatTitle.length; i++) {
        hash = chatTitle.charCodeAt(i) + ((hash << 5) - hash);
    }
    const iconColor = colors[Math.abs(hash) % colors.length];

    console.log(`🤖 Creating forum topic "${chatTitle}" in group ${GROUP_CHAT_ID}...`);

    const result = await botApiRequest('createForumTopic', {
        chat_id: GROUP_CHAT_ID,
        name: `${chatTitle}`,
        icon_color: iconColor
    });

    console.log(`✅ Topic created: "${chatTitle}" → thread_id: ${result.message_thread_id}`);
    return result.message_thread_id;
};

/**
 * Forward a translated message to a specific forum topic
 */
const forwardToTopic = async (threadId, translatedText, senderName, originalText, detectedLang) => {
    if (!GROUP_CHAT_ID) return;

    // Format the message nicely
    let formattedText = `**${senderName}**\n${translatedText}`;

    if (originalText && originalText !== translatedText && detectedLang) {
        formattedText += `\n\n_Original (${detectedLang}): ${originalText}_`;
    }

    try {
        await botApiRequest('sendMessage', {
            chat_id: GROUP_CHAT_ID,
            message_thread_id: threadId,
            text: formattedText,
            parse_mode: 'Markdown'
        });
    } catch (err) {
        // If markdown fails, try without formatting
        try {
            let plainText = `${senderName}\n${translatedText}`;
            if (originalText && originalText !== translatedText) {
                plainText += `\nOriginal (${detectedLang}): ${originalText}`;
            }
            await botApiRequest('sendMessage', {
                chat_id: GROUP_CHAT_ID,
                message_thread_id: threadId,
                text: plainText
            });
        } catch (retryErr) {
            console.error(`❌ Failed to forward to topic ${threadId}:`, retryErr.message);
        }
    }
};

/**
 * Delete a forum topic
 */
const deleteTopicForChat = async (threadId) => {
    if (!GROUP_CHAT_ID || !threadId) return;

    try {
        await botApiRequest('deleteForumTopic', {
            chat_id: GROUP_CHAT_ID,
            message_thread_id: threadId
        });
        console.log(`🗑️ Deleted forum topic thread_id: ${threadId}`);
    } catch (err) {
        console.error(`⚠️ Failed to delete topic ${threadId}:`, err.message);
    }
};

/**
 * Check if bot forwarding is configured
 */
const isBotConfigured = () => {
    return !!(BOT_TOKEN && GROUP_CHAT_ID);
};

module.exports = {
    createTopicForChat,
    forwardToTopic,
    deleteTopicForChat,
    isBotConfigured
};
