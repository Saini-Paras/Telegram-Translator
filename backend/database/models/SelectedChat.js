const mongoose = require('mongoose');

const selectedChatSchema = new mongoose.Schema({
    telegram_chat_id: { type: String, required: true, unique: true },
    title: { type: String },
    type: { type: String }, // 'user', 'group', 'channel'
    topic_thread_id: { type: Number, default: null }, // Forum topic ID for bot forwarding
    added_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('SelectedChat', selectedChatSchema);
