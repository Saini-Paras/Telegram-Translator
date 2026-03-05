const deepl = require('deepl-node');
const dotenv = require('dotenv');
dotenv.config();

let translator;

try {
    if (process.env.DEEPL_API_KEY && process.env.DEEPL_API_KEY !== 'your_deepl_api_key') {
        translator = new deepl.Translator(process.env.DEEPL_API_KEY);
    } else {
        console.warn('DEEPL_API_KEY missing or invalid in .env, translation will not work properly!');
    }
} catch (error) {
    console.error('Failed to initialize DeepL Translator', error);
}

const translateText = async (text, targetLanguage = 'en-US') => {
    if (!text) return { translatedText: '', detectedLanguage: 'unknown' };

    // If DeepL is not correctly initialized yet, fallback
    if (!translator) {
        console.warn('Translator not initialized, returning original text');
        return { translatedText: text, detectedLanguage: 'en' };
    }

    try {
        const result = await translator.translateText(text, null, targetLanguage);
        return {
            translatedText: result.text,
            detectedLanguage: result.detectedSourceLang,
        };
    } catch (error) {
        console.error('Translation error:', error);
        return { translatedText: text, detectedLanguage: 'unknown' };
    }
};

module.exports = { translateText };
