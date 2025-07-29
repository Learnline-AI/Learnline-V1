// AI and TTS Provider Configuration
// Easy switching between providers by changing these constants

export type AIProvider = 'gemini' | 'claude';
export type TTSProvider = 'google' | 'elevenlabs';

// 🚀 MAIN CONFIGURATION - Environment-based for secure deployment
export const AI_CONFIG = {
  // Primary AI provider
  AI_PROVIDER: (process.env.AI_PROVIDER as AIProvider) || 'gemini',
  
  // Primary TTS provider
  TTS_PROVIDER: (process.env.TTS_PROVIDER as TTSProvider) || 'google',
  
  // Fallback providers
  AI_FALLBACK: (process.env.AI_FALLBACK as AIProvider) || 'claude',
  TTS_FALLBACK: (process.env.TTS_FALLBACK as TTSProvider) || 'elevenlabs',
} as const;

// Environment-based API keys for secure deployment
export const API_KEYS = {
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
  GOOGLE_CLOUD_TTS_API_KEY: process.env.GOOGLE_CLOUD_TTS_API_KEY || '',
  GOOGLE_CLOUD_SPEECH_API_KEY: process.env.GOOGLE_CLOUD_SPEECH_API_KEY || process.env.GOOGLE_CLOUD_TTS_API_KEY || '', // Fallback to TTS key
  ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY || '',
  SESSION_SECRET: process.env.SESSION_SECRET || 'your-session-secret-change-this-in-production',
  GITHUB_TOKEN: process.env.GITHUB_TOKEN || '',
} as const;

// Gemini Configuration
export const GEMINI_CONFIG = {
  MODEL: process.env.GEMINI_MODEL || 'gemini-2.0-flash-exp',
  MAX_TOKENS: parseInt(process.env.GEMINI_MAX_TOKENS || '800'),
  TEMPERATURE: parseFloat(process.env.GEMINI_TEMPERATURE || '0.8'),
  SAFETY_SETTINGS: [
    {
      category: 'HARM_CATEGORY_HARASSMENT',
      threshold: 'BLOCK_MEDIUM_AND_ABOVE',
    },
    {
      category: 'HARM_CATEGORY_HATE_SPEECH', 
      threshold: 'BLOCK_MEDIUM_AND_ABOVE',
    },
    {
      category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
      threshold: 'BLOCK_MEDIUM_AND_ABOVE',
    },
    {
      category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
      threshold: 'BLOCK_MEDIUM_AND_ABOVE',
    },
  ],
} as const;

// Claude Configuration (for fallback)
export const CLAUDE_CONFIG = {
  MODEL: process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',
  MAX_TOKENS: parseInt(process.env.CLAUDE_MAX_TOKENS || '800'),
  TEMPERATURE: parseFloat(process.env.CLAUDE_TEMPERATURE || '0.8'),
} as const;

// Google TTS Configuration - Using Chirp3 HD Hindi voice
export const GOOGLE_TTS_CONFIG = {
  VOICE: {
    languageCode: process.env.GOOGLE_TTS_LANGUAGE_CODE || 'hi-IN',
    name: process.env.GOOGLE_TTS_VOICE_NAME || 'hi-IN-Neural2-A',
    ssmlGender: 'FEMALE',
  },
  AUDIO_CONFIG: {
    audioEncoding: 'MP3',
    speakingRate: parseFloat(process.env.GOOGLE_TTS_SPEAKING_RATE || '0.85'),
    pitch: 0.0,
    volumeGainDb: 0.0,
  },
  // Alternative voices for different contexts
  ALTERNATIVE_VOICES: {
    MALE: 'hi-IN-Neural2-C',
    FEMALE_ALT: 'hi-IN-Neural2-D', 
    WAVENET_FEMALE: 'hi-IN-Wavenet-A',
    WAVENET_MALE: 'hi-IN-Wavenet-B',
  },
} as const;

// ElevenLabs Configuration (for fallback)
export const ELEVENLABS_CONFIG = {
  VOICE_ID: process.env.ELEVENLABS_VOICE_ID || 'FIIBqolBA6JRqu2Lzpd7',
  MODEL_ID: process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2',
  VOICE_SETTINGS: {
    stability: parseFloat(process.env.ELEVENLABS_STABILITY || '0.7'),
    similarity_boost: parseFloat(process.env.ELEVENLABS_SIMILARITY_BOOST || '0.8'),
    style: parseFloat(process.env.ELEVENLABS_STYLE || '0.1'),
    use_speaker_boost: true,
  },
} as const;

// System Prompts for different providers
export const SYSTEM_PROMPTS = {
  HINDI_TEACHER_BASE: `आप रवि भैया हैं - एक दोस्ताना शिक्षक जो फोन पर छात्रों को पढ़ाते हैं। आप SIRF हिंदी में बात करते हैं।`,
  
  TEACHING_STYLE: `
बोलने का तरीका:
- सीधे और संक्षिप्त जवाब दें (20-30 शब्द maximum)
- technical terms को पहले हिंदी में बताएं, फिर bracket में English
- गणित: "तीन गुणा चार बराबर बारह" (3×4=12)
- हर जवाब के अंत में एक छोटा सवाल पूछें

व्यक्तित्व:
- सरल भाषा उपयोग करें
- "शाबाश!" या "बिल्कुल सही!" कहें
- गलती पर: "चलो दोबारा कोशिश करते हैं"

मुख्य नियम:
- लंबी व्याख्या न दें - सीधे point पर आएं
- एक बार में एक ही concept समझाएं
- रोज़मर्रा के छोटे उदाहरण दें
- जटिल शब्दों से बचें

विशेष निर्देश:
- NCERT के अनुसार पढ़ाएं
- ग्रामीण छात्रों के लिए सरल उदाहरण
- homework और exam preparation पर focus करें

याद रखें: छात्र push-to-speak button दबाकर सवाल पूछते हैं। आपका जवाब छोटा और स्पष्ट होना चाहिए।`,

  RAG_ENHANCED: `आप रवि भैया हैं - एक NCERT कक्षा 9 भौतिक विज्ञान शिक्षक हैं। नीचे दिए गए समृद्ध शिक्षण संदर्भ का उपयोग करके छात्र के सवाल का जवाब दें। यह संदर्भ learning objectives, real-world examples, और common misconceptions के साथ आता है।`,

  FALLBACK_SIMPLE: `आप रवि भैया हैं - एक मित्रवत और जानकार शिक्षक। हमेशा हिंदी में जवाब दें।

You must ALWAYS respond in Hindi (Devanagari script). Never use English for the main response. You can mention English technical terms in parentheses if needed.

Teaching style:
- हमेशा हिंदी में बोलें
- उत्साहजनक और धैर्यवान रहें  
- सरल भाषा का उपयोग करें
- प्रश्न के अंत में एक follow-up प्रश्न पूछें

Example: "नमस्ते! गुरुत्वाकर्षण एक बहुत ही दिलचस्प विषय है। यह एक अदृश्य बल है जो सभी वस्तुओं को पृथ्वी की ओर खींचता है। क्या आप जानते हैं कि चाँद पर गुरुत्वाकर्षण पृथ्वी से कम क्यों है?"`,
} as const;

// Environment variable validation
export function validateEnvironment(): { isValid: boolean; missing: string[] } {
  const requiredKeys = [
    'GEMINI_API_KEY',
    'ANTHROPIC_API_KEY', 
    'GOOGLE_CLOUD_TTS_API_KEY',
    'ELEVENLABS_API_KEY'
  ];
  
  const missing = requiredKeys.filter(key => !process.env[key]);
  
  return {
    isValid: missing.length === 0,
    missing,
  };
}