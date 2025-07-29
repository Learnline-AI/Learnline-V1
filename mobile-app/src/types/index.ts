export interface ChatMessage {
  id: string;
  type: 'student' | 'ai';
  content: string;
  audioUrl?: string;
  timestamp: Date;
  duration?: string;
  audioChunks?: AudioChunk[]; // New: Store multiple audio chunks per message
  isPlayingAudio?: boolean; // New: Track if this message's audio is playing
}

export interface AudioChunk {
  id: number;
  text: string;
  audioUrl: string;
  isLoaded: boolean;
  hasError?: boolean;
  errorMessage?: string;
}

export interface AudioQueueState {
  isPlaying: boolean;
  currentMessageId: string | null;
  currentChunkIndex: number;
  totalChunks: number;
  isLoading: boolean;
}

export interface VoiceConfig {
  voiceName: string;
  languageCode: string;
  speakingRate: number;
}

export interface APIConfig {
  anthropicApiKey: string;
  googleServiceAccount: string;
}

export interface UserSettings {
  preferredLanguage: 'hindi' | 'english' | 'hinglish';
  speechRate: number;
  voiceType: string;
  offlineMode: boolean;
}

export interface LearningStats {
  questionsAsked: number;
  topicsCovered: number;
  studyTimeMinutes: number;
  currentStreak: number;
}

export interface APIResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface TeacherResponse {
  answer: string;
  audioUrl?: string;
}

export interface TTSResponse {
  audioUrl: string;
  provider?: string;
}