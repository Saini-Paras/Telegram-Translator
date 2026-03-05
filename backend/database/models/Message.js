const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    telegram_message_id: { type: Number, required: true },
    telegram_chat_id: { type: String, required: true },
    username: { type: String },
    user_avatar: { type: String },
    original_text: { type: String, required: true },
    detected_language: { type: String },
    translated_text: { type: String },
    target_language: { type: String, required: true },
    timestamp: { type: Date, required: true },
});

messageSchema.index({ telegram_message_id: 1, target_language: 1 }, { unique: true });

const Message = mongoose.model('Message', messageSchema);

module.exports = Message;
