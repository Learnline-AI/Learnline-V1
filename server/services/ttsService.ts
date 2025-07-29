// TTS Service - Abstracted provider handling
import { AI_CONFIG, GOOGLE_TTS_CONFIG, ELEVENLABS_CONFIG, API_KEYS } from '../config/aiConfig';

export interface TTSResponse {
  audioUrl: string;
  provider: string;
}

// Language detection helper (reused from original)
export function detectLanguage(text: string): "hindi" | "hinglish" | "english" {
  const hindiChars = /[\u0900-\u097F]/g;
  const englishWords = /\b[a-zA-Z]+\b/g;

  const hindiMatches = text.match(hindiChars)?.length || 0;
  const englishMatches = text.match(englishWords)?.length || 0;
  const totalChars = text.length;

  const hindiPercentage = hindiMatches / totalChars;

  console.log(
    `Language detection: Hindi chars: ${hindiMatches}, English words: ${englishMatches}, Hindi %: ${hindiPercentage.toFixed(2)}`,
  );

  if (hindiMatches > 0) {
    if (englishMatches > 3 && hindiPercentage < 0.7) {
      console.log("Detected: Hinglish");
      return "hinglish";
    }
    console.log("Detected: Hindi");
    return "hindi";
  }

  const romanizedHindi =
    /\b(hai|hain|ke|mein|aur|kya|kaise|kahan|kyun|lekin|phir|ab|yeh|voh|main|tum|hum|koi|sab|kuch|bahut|bhi|kar|kya|agar|jab|tab|fir|nahin|nahi|achha|theek|samjha|samjhi)\b/gi;
  if (romanizedHindi.test(text)) {
    console.log("Detected: Hinglish (romanized)");
    return "hinglish";
  }

  console.log("Detected: English");
  return "english";
}

// Text preprocessing for mathematical symbols
function preprocessTextForTTS(text: string): string {
  return text
    // Handle equations with variables and numbers: p = mv, m = mass, v = velocity
    .replace(
      /([a-zA-Z]+)\s*=\s*([a-zA-Z][a-zA-Z\s]*)/g,
      '$1 equals <break time="0.5s"/> $2',
    )
    // Handle number equations: 8000 × 5 = 40,000
    .replace(
      /([\d.,]+)\s*×\s*([\d.,]+)\s*=\s*([\d.,]+)/g,
      '$1 times <break time="0.5s"/> $2 equals <break time="0.5s"/> $3',
    )
    // Handle variable equations: p = mv (where mv is multiplication)
    .replace(
      /([a-zA-Z])\s*=\s*([a-zA-Z])([a-zA-Z])/g,
      '$1 equals <break time="0.5s"/> $2 times <break time="0.5s"/> $3',
    )
    // Handle standalone multiplications: 0.15 × 20
    .replace(/([\d.,]+)\s*×\s*([\d.,]+)/g, '$1 times <break time="0.5s"/> $2')
    // Handle variable multiplications: m × v
    .replace(
      /([a-zA-Z])\s*×\s*([a-zA-Z])/g,
      '$1 times <break time="0.5s"/> $2',
    )
    // Handle standalone equals: = 3, = mass
    .replace(/\s*=\s*([\d.,]+)/g, ' equals <break time="0.5s"/> $1')
    .replace(
      /\s*=\s*([a-zA-Z][a-zA-Z\s]*)/g,
      ' equals <break time="0.5s"/> $1',
    )
    // Handle other mathematical symbols
    .replace(/([\d.,]+)\s*\+\s*([\d.,]+)/g, '$1 plus <break time="0.5s"/> $2')
    .replace(
      /([\d.,]+)\s*÷\s*([\d.,]+)/g,
      '$1 divided by <break time="0.5s"/> $2',
    )
    // Handle unit notations like kg·m/s (replace · with space)
    .replace(/·/g, " ");
}

// Main TTS generation function
export async function generateTTS(
  text: string,
  voiceConfig?: any
): Promise<TTSResponse> {
  
  const processedText = preprocessTextForTTS(text);
  const detectedLanguage = detectLanguage(text);
  
  console.log(`TTS request: ${AI_CONFIG.TTS_PROVIDER} (primary), text: "${processedText.substring(0, 30)}..."`);
  
  // Try primary provider first
  try {
    if (AI_CONFIG.TTS_PROVIDER === 'google') {
      // Clean voiceConfig to remove any ElevenLabs-specific fields
      const cleanVoiceConfig = voiceConfig ? {
        languageCode: voiceConfig.languageCode || (detectedLanguage === 'hindi' ? 'hi-IN' : 'en-US'),
        name: voiceConfig.name,
        ssmlGender: voiceConfig.ssmlGender,
        audioConfig: voiceConfig.audioConfig,
      } : undefined;
      return await generateGoogleTTS(processedText, cleanVoiceConfig);
    } else if (AI_CONFIG.TTS_PROVIDER === 'elevenlabs') {
      return await generateElevenLabsTTS(processedText, { ...voiceConfig, language: detectedLanguage });
    }
  } catch (error) {
    console.warn(`Primary TTS provider (${AI_CONFIG.TTS_PROVIDER}) failed:`, error);
  }
  
  // Fallback to secondary provider
  try {
    if (AI_CONFIG.TTS_FALLBACK === 'elevenlabs') {
      console.log('Falling back to ElevenLabs TTS');
      return await generateElevenLabsTTS(processedText, { ...voiceConfig, language: detectedLanguage });
    } else if (AI_CONFIG.TTS_FALLBACK === 'google') {
      console.log('Falling back to Google TTS');
      return await generateGoogleTTS(processedText, voiceConfig);
    }
  } catch (fallbackError) {
    console.error(`Fallback TTS provider (${AI_CONFIG.TTS_FALLBACK}) also failed:`, fallbackError);
  }
  
  throw new Error('All TTS providers unavailable');
}

// Google TTS implementation
async function generateGoogleTTS(
  text: string,
  voiceConfig?: any
): Promise<TTSResponse> {
  const apiKey = API_KEYS.GOOGLE_CLOUD_TTS_API_KEY;

  // Use Chirp3 HD Hindi voice as default, allow override
  // Only pick valid Google TTS voice fields to avoid API errors
  const finalVoiceConfig = {
    ...GOOGLE_TTS_CONFIG.VOICE,
    ...(voiceConfig && {
      languageCode: voiceConfig.languageCode,
      name: voiceConfig.name,
      ssmlGender: voiceConfig.ssmlGender,
    }),
  };

  const finalAudioConfig = {
    ...GOOGLE_TTS_CONFIG.AUDIO_CONFIG,
    ...voiceConfig?.audioConfig,
  };

  console.log(`Using Google TTS with voice: ${finalVoiceConfig.name}`);

  const ttsResponse = await fetch(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: { text },
        voice: finalVoiceConfig,
        audioConfig: finalAudioConfig,
      }),
    },
  );

  if (!ttsResponse.ok) {
    const errorText = await ttsResponse.text();
    throw new Error(
      `Google TTS API error: ${ttsResponse.status} - ${errorText}`,
    );
  }

  const ttsData = await ttsResponse.json();

  if (!ttsData.audioContent) {
    throw new Error("No audio content received from Google TTS");
  }

  return {
    audioUrl: `data:audio/mpeg;base64,${ttsData.audioContent}`,
    provider: 'google',
  };
}

// ElevenLabs TTS implementation (fallback)
async function generateElevenLabsTTS(
  text: string,
  voiceConfig: any
): Promise<TTSResponse> {
  const apiKey = API_KEYS.ELEVENLABS_API_KEY;

  const voiceId = ELEVENLABS_CONFIG.VOICE_ID;
  console.log(`Using ElevenLabs TTS with voice ID: ${voiceId}`);

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: "POST",
      headers: {
        Accept: "audio/mpeg",
        "Content-Type": "application/json",
        "xi-api-key": apiKey,
      },
      body: JSON.stringify({
        text: text,
        model_id: ELEVENLABS_CONFIG.MODEL_ID,
        voice_settings: ELEVENLABS_CONFIG.VOICE_SETTINGS,
        pronunciation_dictionary_locators: [],
        seed: null,
        previous_text: null,
        next_text: null,
        previous_request_ids: [],
        next_request_ids: [],
      }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();

    if (response.status === 401 && errorText.includes("quota_exceeded")) {
      console.log(
        "ElevenLabs quota exceeded - consider upgrading plan for longer responses",
      );
    }

    throw new Error(
      `ElevenLabs API error: ${response.status} - ${errorText}`,
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  const base64Audio = Buffer.from(arrayBuffer).toString("base64");

  return {
    audioUrl: `data:audio/mpeg;base64,${base64Audio}`,
    provider: 'elevenlabs',
  };
}