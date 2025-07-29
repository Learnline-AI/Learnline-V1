// AI Service - Abstracted provider handling
import { GoogleGenerativeAI } from '@google/generative-ai';
import Anthropic from "@anthropic-ai/sdk";
import { AI_CONFIG, GEMINI_CONFIG, CLAUDE_CONFIG, SYSTEM_PROMPTS, API_KEYS } from '../config/aiConfig';

// AI providers initialization
let geminiClient: GoogleGenerativeAI | null = null;
let anthropicClient: Anthropic | null = null;

// Initialize providers with hardcoded keys
geminiClient = new GoogleGenerativeAI(API_KEYS.GEMINI_API_KEY);

anthropicClient = new Anthropic({
  apiKey: API_KEYS.ANTHROPIC_API_KEY,
});

export interface AIResponse {
  content: string;
  provider: string;
}

export interface StreamingAIResponse {
  stream: AsyncIterable<{ type: 'text_delta' | 'complete'; text?: string; fullText?: string }>;
  provider: string;
}

// Gemini streaming response generator
async function* geminiStreamGenerator(model: any, prompt: string) {
  try {
    const result = await model.generateContentStream(prompt);
    
    let fullText = '';
    for await (const chunk of result.stream) {
      const chunkText = chunk.text();
      if (chunkText) {
        fullText += chunkText;
        yield {
          type: 'text_delta' as const,
          text: chunkText,
          fullText: fullText,
        };
      }
    }
    
    yield {
      type: 'complete' as const,
      fullText: fullText,
    };
  } catch (error) {
    console.error('Gemini streaming error:', error);
    throw error;
  }
}

// Claude streaming response generator
async function* claudeStreamGenerator(stream: any) {
  try {
    let fullText = '';
    
    for await (const messageStreamEvent of stream) {
      if (messageStreamEvent.type === "content_block_delta") {
        const delta = messageStreamEvent.delta;
        if (delta.type === "text_delta") {
          fullText += delta.text;
          yield {
            type: 'text_delta' as const,
            text: delta.text,
            fullText: fullText,
          };
        }
      }
    }
    
    yield {
      type: 'complete' as const,
      fullText: fullText,
    };
  } catch (error) {
    console.error('Claude streaming error:', error);
    throw error;
  }
}

// Main AI generation function with provider abstraction
export async function generateAIResponse(
  userMessage: string,
  systemPrompt: string = SYSTEM_PROMPTS.HINDI_TEACHER_BASE,
  streaming: boolean = false
): Promise<AIResponse | StreamingAIResponse> {
  
  const fullSystemPrompt = systemPrompt + "\n\n" + SYSTEM_PROMPTS.TEACHING_STYLE;
  
  // Try primary provider first
  try {
    if (AI_CONFIG.AI_PROVIDER === 'gemini' && geminiClient) {
      return await generateGeminiResponse(userMessage, fullSystemPrompt, streaming);
    } else if (AI_CONFIG.AI_PROVIDER === 'claude' && anthropicClient) {
      return await generateClaudeResponse(userMessage, fullSystemPrompt, streaming);
    }
  } catch (error) {
    console.warn(`Primary AI provider (${AI_CONFIG.AI_PROVIDER}) failed:`, error);
  }
  
  // Fallback to secondary provider
  try {
    if (AI_CONFIG.AI_FALLBACK === 'claude' && anthropicClient) {
      console.log('Falling back to Claude');
      return await generateClaudeResponse(userMessage, fullSystemPrompt, streaming);
    } else if (AI_CONFIG.AI_FALLBACK === 'gemini' && geminiClient) {
      console.log('Falling back to Gemini');
      return await generateGeminiResponse(userMessage, fullSystemPrompt, streaming);
    }
  } catch (fallbackError) {
    console.error(`Fallback AI provider (${AI_CONFIG.AI_FALLBACK}) also failed:`, fallbackError);
  }
  
  throw new Error('All AI providers unavailable');
}

// Gemini-specific generation
async function generateGeminiResponse(
  userMessage: string,
  systemPrompt: string,
  streaming: boolean
): Promise<AIResponse | StreamingAIResponse> {
  
  if (!geminiClient) {
    throw new Error('Gemini client not initialized');
  }
  
  const model = geminiClient.getGenerativeModel({
    model: GEMINI_CONFIG.MODEL,
    systemInstruction: systemPrompt,
    generationConfig: {
      maxOutputTokens: GEMINI_CONFIG.MAX_TOKENS,
      temperature: GEMINI_CONFIG.TEMPERATURE,
    },
    safetySettings: GEMINI_CONFIG.SAFETY_SETTINGS,
  });
  
  if (streaming) {
    return {
      stream: geminiStreamGenerator(model, userMessage),
      provider: 'gemini',
    };
  } else {
    const result = await model.generateContent(userMessage);
    const response = await result.response;
    return {
      content: response.text(),
      provider: 'gemini',
    };
  }
}

// Claude-specific generation
async function generateClaudeResponse(
  userMessage: string,
  systemPrompt: string,
  streaming: boolean
): Promise<AIResponse | StreamingAIResponse> {
  
  if (!anthropicClient) {
    throw new Error('Claude client not initialized');
  }
  
  const messageParams = {
    model: CLAUDE_CONFIG.MODEL,
    max_tokens: CLAUDE_CONFIG.MAX_TOKENS,
    temperature: CLAUDE_CONFIG.TEMPERATURE,
    system: systemPrompt,
    messages: [
      {
        role: "user" as const,
        content: userMessage,
      },
    ],
  };
  
  if (streaming) {
    const stream = await anthropicClient.messages.create({
      ...messageParams,
      stream: true,
    });
    
    return {
      stream: claudeStreamGenerator(stream),
      provider: 'claude',
    };
  } else {
    const response = await anthropicClient.messages.create(messageParams);
    const content = response.content[0].type === "text" ? response.content[0].text : "";
    
    return {
      content,
      provider: 'claude',
    };
  }
}

// Test connection function
export async function testAIConnection(): Promise<{ success: boolean; provider: string; error?: string }> {
  try {
    const response = await generateAIResponse('Say "Hello"', SYSTEM_PROMPTS.FALLBACK_SIMPLE, false);
    
    if ('content' in response) {
      return {
        success: true,
        provider: response.provider,
      };
    }
    
    return {
      success: false,
      provider: 'unknown',
      error: 'Invalid response format',
    };
  } catch (error) {
    return {
      success: false,
      provider: AI_CONFIG.AI_PROVIDER,
      error: error instanceof Error ? error.message : 'Connection test failed',
    };
  }
}