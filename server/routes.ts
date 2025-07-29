import type { Express } from "express";
import { createServer, type Server } from "http";
import { Server as SocketIOServer } from "socket.io";
import { storage } from "./storage";
import { ragService } from "./services/ragService";
import { generateAIResponse, testAIConnection } from "./services/aiService";
import { generateTTS, detectLanguage } from "./services/ttsService";
import { AI_CONFIG, SYSTEM_PROMPTS, API_KEYS } from "./config/aiConfig";
import { getRNNoiseService } from "./services/rnnoiseService";
import { getErrorMonitoringService } from "./services/errorMonitoring";
import { ConversationVAD, createVADInstance, getOptimalVADConfig, type VADEvent, type ConversationState } from "./services/vadService";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import ffmpeg from "fluent-ffmpeg";

// Note: AI clients are now initialized in aiService.ts

// Persistent audio chunk storage with session management
const audioChunksStorage = new Map<string, string>(); // key: sessionId-chunkId, value: audioUrl
const sessionCleanupTimeouts = new Map<string, NodeJS.Timeout>();

// Generate unique session ID for each request
const generateSessionId = () => Math.random().toString(36).substring(2, 15);

export async function registerRoutes(app: Express): Promise<Server> {
  // Health check endpoint
  app.get("/api/health", (req, res) => {
    res.json({ 
      status: "OK", 
      timestamp: new Date().toISOString(),
      aiProvider: AI_CONFIG.AI_PROVIDER,
      ttsProvider: AI_CONFIG.TTS_PROVIDER,
    });
  });

  // RNNoise system health endpoint
  app.get("/api/health-rnnoise", (req, res) => {
    try {
      const errorMonitoring = getErrorMonitoringService();
      const rnnoiseService = getRNNoiseService();
      
      const systemHealth = errorMonitoring.getSystemHealth();
      const rnnoiseStats = rnnoiseService.getStats();
      
      res.json({
        timestamp: new Date().toISOString(),
        systemHealth,
        rnnoiseService: {
          enabled: rnnoiseService.isServiceEnabled(),
          activeProvider: rnnoiseService.getActiveProvider(),
          stats: rnnoiseStats
        },
        recommendations: systemHealth.recommendations
      });
    } catch (error) {
      console.error('Error getting RNNoise health:', error);
      res.status(500).json({
        error: 'Failed to get RNNoise health status',
        timestamp: new Date().toISOString()
      });
    }
  });

  // RNNoise diagnostic report endpoint
  app.get("/api/rnnoise-diagnostics", (req, res) => {
    try {
      const errorMonitoring = getErrorMonitoringService();
      const report = errorMonitoring.generateDiagnosticReport();
      
      res.setHeader('Content-Type', 'text/plain');
      res.send(report);
    } catch (error) {
      console.error('Error generating RNNoise diagnostics:', error);
      res.status(500).json({
        error: 'Failed to generate diagnostic report',
        timestamp: new Date().toISOString()
      });
    }
  });

  // RNNoise error history endpoint
  app.get("/api/rnnoise-errors", (req, res) => {
    try {
      const errorMonitoring = getErrorMonitoringService();
      const component = req.query.component as string;
      const limit = parseInt(req.query.limit as string) || 50;
      
      let errors;
      if (component) {
        errors = errorMonitoring.getComponentErrors(component, limit);
      } else {
        errors = errorMonitoring.getUnresolvedErrors().slice(0, limit);
      }
      
      res.json({
        timestamp: new Date().toISOString(),
        component: component || 'all',
        errors: errors.map(error => ({
          id: error.id,
          timestamp: new Date(error.timestamp).toISOString(),
          component: error.component,
          severity: error.severity,
          errorType: error.errorType,
          message: error.message,
          resolved: error.resolved,
          recoveryAction: error.recoveryAction,
          context: error.context
        }))
      });
    } catch (error) {
      console.error('Error getting RNNoise errors:', error);
      res.status(500).json({
        error: 'Failed to get error history',
        timestamp: new Date().toISOString()
      });
    }
  });

  // Diagnostic endpoint to verify environment variables
  app.get("/api/diagnostics", (req, res) => {
    const envVars = {
      NODE_ENV: process.env.NODE_ENV,
      PORT: process.env.PORT,
      AI_PROVIDER: process.env.AI_PROVIDER || 'not set',
      TTS_PROVIDER: process.env.TTS_PROVIDER || 'not set',
      // Check if API keys exist (don't expose the actual values)
      GEMINI_API_KEY: process.env.GEMINI_API_KEY ? 'set' : 'NOT SET',
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ? 'set' : 'NOT SET',
      ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY ? 'set' : 'NOT SET',
      GOOGLE_CLOUD_TTS_API_KEY: process.env.GOOGLE_CLOUD_TTS_API_KEY ? 'set' : 'NOT SET',
      GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS ? 'set' : 'NOT SET',
      SESSION_SECRET: process.env.SESSION_SECRET ? 'set' : 'NOT SET',
      // Additional useful info
      configuredAI: AI_CONFIG.AI_PROVIDER,
      configuredTTS: AI_CONFIG.TTS_PROVIDER,
      availableProviders: AI_CONFIG.availableProviders,
      workingDirectory: process.cwd(),
      nodeVersion: process.version,
    };

    res.json({
      status: "Diagnostic Information",
      environment: envVars,
      timestamp: new Date().toISOString(),
    });
  });

  // RAG status endpoint
  app.get("/api/rag/status", (req, res) => {
    const stats = ragService.getStats();
    res.json({
      isAvailable: ragService.isRagAvailable(),
      totalChunks: stats.totalChunks,
      isLoaded: stats.isLoaded,
      chapter: "8",
      chapterTitle: "Force and Laws of Motion",
    });
  });

  // RAG test search endpoint
  app.post("/api/rag/search", async (req, res) => {
    try {
      const { query, topK = 3 } = req.body;

      if (!query) {
        return res.status(400).json({ error: "Query is required" });
      }

      if (!ragService.isRagAvailable()) {
        return res.status(503).json({ error: "RAG service not available" });
      }

      // Generate mock embedding for the query
      const queryEmbedding = await ragService.mockEmbedding(query);

      // Find similar chunks
      const similarChunks = await ragService.findSimilarChunks(queryEmbedding, {
        topK,
        chapterFilter: "8",
      });

      res.json({
        query,
        results: similarChunks.map((s) => ({
          id: s.chunk.id,
          type: s.chunk.type,
          section: s.chunk.section,
          similarity: s.similarity,
          content: s.chunk.content.substring(0, 200) + "...",
          aiMetadata: {
            difficulty_level: s.chunk.ai_metadata.difficulty_level,
            concepts: s.chunk.ai_metadata.concepts?.slice(0, 3),
          },
        })),
      });
    } catch (error) {
      console.error("RAG search error:", error);
      res.status(500).json({ error: "Search failed" });
    }
  });

  // Smart chunking streaming endpoint with optional RAG enhancement
  app.post("/api/ask-teacher-stream", async (req, res) => {
    try {
      const { question, useRag = false } = req.body;

      if (!question) {
        return res.status(400).json({ error: "Question is required" });
      }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("Access-Control-Allow-Origin", "*");

      const language = detectLanguage(question);
      const sessionId = generateSessionId();
      console.log(`🚀 Starting streaming session: ${sessionId}`, {
        question: question.substring(0, 50) + '...',
        useRag,
        aiProvider: AI_CONFIG.AI_PROVIDER,
        ttsProvider: AI_CONFIG.TTS_PROVIDER,
        language,
        hasGeminiKey: !!process.env.GEMINI_API_KEY,
        hasClaudeKey: !!process.env.ANTHROPIC_API_KEY,
        hasGoogleTtsKey: !!process.env.GOOGLE_CLOUD_TTS_API_KEY,
        hasElevenLabsKey: !!process.env.ELEVENLABS_API_KEY
      });

      let systemPrompt = SYSTEM_PROMPTS.HINDI_TEACHER_BASE;
      let userMessage = question;

      // RAG Enhancement (optional)
      if (useRag && ragService.isRagAvailable()) {
        try {
          const startTime = Date.now();

          // Generate embedding for the question (mock for now)
          const queryEmbedding = await ragService.mockEmbedding(question);

          // Find similar chunks
          const similarChunks = await ragService.findSimilarChunks(
            queryEmbedding,
            {
              topK: 3,
              chapterFilter: "8", // Force and Laws of Motion
            },
          );

          if (similarChunks.length > 0) {
            // Use enhanced RAG methods for rich metadata extraction
            const enhancedPrompt = await ragService.generateEnhancedResponse(
              question,
              similarChunks,
              language,
            );

            // Override system prompt for enhanced RAG
            systemPrompt = SYSTEM_PROMPTS.RAG_ENHANCED;
            userMessage = enhancedPrompt;

            // Log RAG usage
            const endTime = Date.now();
            await storage.logRagQuery({
              userId: null, // Anonymous for now
              query: question,
              language,
              ragEnabled: true,
              retrievedChunks: similarChunks.map((s) => ({
                id: s.chunk.id,
                similarity: s.similarity,
                type: s.chunk.type,
                section: s.chunk.section,
              })),
              responseTime: endTime - startTime,
            });

            console.log(
              `RAG enhanced query: ${similarChunks.length} chunks retrieved`,
            );
          }
        } catch (ragError) {
          console.error(
            "RAG enhancement failed, falling back to standard response:",
            ragError,
          );
          // Continue with standard response
        }
      }

      // 🚀 Use abstracted AI service instead of direct Claude call
      const aiResponse = await generateAIResponse(userMessage, systemPrompt, true);
      
      if (!('stream' in aiResponse)) {
        throw new Error('Expected streaming response');
      }

      let fullResponse = "";
      let currentChunk = "";
      let chunkId = 0;

      const ttsPromises: Promise<void>[] = [];

      // Helper function to check if we should send chunk for TTS
      const shouldSendChunk = (text: string): boolean => {
        // Send chunk only on complete sentence boundaries
        // Hindi: । (devanagari danda), English: . ! ?
        const hasSentenceBoundary = /[.!?।]\s*$/.test(text.trim());

        return hasSentenceBoundary;
      };

      // Function to send chunk for TTS conversion - returns promise
      const processChunkForTTSPromise = async (
        chunkText: string,
        chunkIndex: number,
      ): Promise<void> => {
        try {
          // Detect language for each chunk individually for better voice selection
          const chunkLanguage = detectLanguage(chunkText);
          console.log(
            `Chunk ${chunkIndex} language detected: ${chunkLanguage}`,
          );
          console.log(`Starting TTS conversion for chunk ${chunkIndex}...`);

          // 🚀 Use abstracted TTS service
          const ttsResult = await generateTTS(chunkText, {
            languageCode: chunkLanguage === 'hindi' ? 'hi-IN' : 'en-US',
          });
          
          console.log(
            `TTS conversion successful for chunk ${chunkIndex}, Provider: ${ttsResult.provider}, URL length: ${ttsResult.audioUrl.length}`,
          );

          // Store audio data for separate retrieval with session key
          const storageKey = `${sessionId}-${chunkIndex}`;
          audioChunksStorage.set(storageKey, ttsResult.audioUrl);
          console.log(
            `Stored audio chunk ${chunkIndex} in persistent storage with key: ${storageKey}`,
          );

          // Send audio chunk reference instead of full data to avoid SSE size limits
          const audioChunkData = {
            type: "audio_ready",
            chunkId: chunkIndex,
            text: chunkText,
            audioLength: ttsResult.audioUrl.length,
            detectedLanguage: chunkLanguage,
            sessionId: sessionId,
            ttsProvider: ttsResult.provider,
          };

          console.log(
            `Sending audio chunk ${chunkIndex} notification to frontend`,
          );
          res.write(`data: ${JSON.stringify(audioChunkData)}\n\n`);
        } catch (error) {
          console.error(`Error generating TTS for chunk ${chunkIndex}:`, error);
          res.write(
            `data: ${JSON.stringify({
              type: "audio_error",
              chunkId: chunkIndex,
              text: chunkText,
              error:
                error instanceof Error
                  ? error.message
                  : "TTS conversion failed",
            })}\n\n`,
          );
        }
      };

      // Process AI streaming response
      for await (const chunk of aiResponse.stream) {
        if (chunk.type === 'text_delta' && chunk.text) {
          fullResponse += chunk.text;
          currentChunk += chunk.text;

          // Send text chunk immediately for display
          res.write(
            `data: ${JSON.stringify({
              type: "text_chunk",
              text: chunk.text,
              fullText: fullResponse,
              aiProvider: aiResponse.provider,
            })}\n\n`,
          );

          // Check if we should process this chunk for TTS (sentence boundary)
          if (shouldSendChunk(currentChunk)) {
            const chunkToProcess = currentChunk.trim();
            const currentChunkId = chunkId++;

            console.log(
              `📝 SENTENCE COMPLETE: Processing chunk ${currentChunkId} (${chunkToProcess.length} chars): ${chunkToProcess}`,
            );

            // Collect TTS promise to wait for completion
            ttsPromises.push(
              processChunkForTTSPromise(chunkToProcess, currentChunkId),
            );

            // Reset for next chunk
            currentChunk = "";
          }
        } else if (chunk.type === 'complete') {
          // Handle completion
          break;
        }
      }

      // Process any remaining chunk
      if (currentChunk.trim().length > 0) {
        const chunkToProcess = currentChunk.trim();
        const currentChunkId = chunkId++;
        ttsPromises.push(
          processChunkForTTSPromise(chunkToProcess, currentChunkId),
        );
      }

      // Send text completion event immediately to allow audio playback to start
      console.log(
        `Text streaming complete. ${ttsPromises.length} TTS chunks processing in background...`,
      );

      res.write(
        `data: ${JSON.stringify({
          type: "text_complete",
          fullText: fullResponse,
          totalChunks: chunkId,
          aiProvider: aiResponse.provider,
        })}\n\n`,
      );

      // Keep connection open and wait for all TTS chunks to complete
      await Promise.all(ttsPromises);
      console.log(`All ${ttsPromises.length} TTS chunks completed`);

      res.write(
        `data: ${JSON.stringify({
          type: "complete",
          fullText: fullResponse,
          totalChunks: chunkId,
          aiProvider: aiResponse.provider,
        })}\n\n`,
      );

      res.end();
    } catch (error) {
      console.error("❌ STREAMING ERROR:", {
        error: error instanceof Error ? error.message : error,
        stack: error instanceof Error ? error.stack : undefined,
        aiProvider: AI_CONFIG.AI_PROVIDER,
        ttsProvider: AI_CONFIG.TTS_PROVIDER,
        hasGeminiKey: !!process.env.GEMINI_API_KEY,
        hasClaudeKey: !!process.env.ANTHROPIC_API_KEY,
        hasGoogleTtsKey: !!process.env.GOOGLE_CLOUD_TTS_API_KEY,
        hasElevenLabsKey: !!process.env.ELEVENLABS_API_KEY
      });
      
      // Send error to client via SSE
      res.write(
        `data: ${JSON.stringify({
          type: "error",
          error: error instanceof Error ? error.message : "Failed to get AI response",
          details: process.env.NODE_ENV === 'development' ? {
            provider: AI_CONFIG.AI_PROVIDER,
            hasRequiredKeys: {
              gemini: !!process.env.GEMINI_API_KEY,
              claude: !!process.env.ANTHROPIC_API_KEY,
              googleTts: !!process.env.GOOGLE_CLOUD_TTS_API_KEY,
              elevenLabs: !!process.env.ELEVENLABS_API_KEY
            }
          } : undefined
        })}\n\n`,
      );
      res.end();
    }
  });

  // Keep original non-streaming endpoint for fallback
  app.post("/api/ask-teacher", async (req, res) => {
    try {
      const { question } = req.body;

      if (!question) {
        return res.status(400).json({ error: "Question is required" });
      }

      // 🚀 Use abstracted AI service
      const aiResponse = await generateAIResponse(question, SYSTEM_PROMPTS.HINDI_TEACHER_BASE, false);
      
      if ('stream' in aiResponse) {
        throw new Error('Expected non-streaming response');
      }

      res.json({
        success: true,
        answer: aiResponse.content,
        audioUrl: null, // TTS will be handled separately
        provider: aiResponse.provider,
      });
    } catch (error) {
      console.error("Error in ask-teacher:", error);
      res.status(500).json({
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to get AI response",
      });
    }
  });

  // Audio chunk retrieval endpoint
  app.get("/api/audio-chunk/:sessionId/:chunkId", (req, res) => {
    try {
      const { sessionId, chunkId } = req.params;
      const chunkIdNum = parseInt(chunkId);

      if (isNaN(chunkIdNum)) {
        return res
          .status(400)
          .json({ success: false, error: "Invalid chunk ID" });
      }

      // Retrieve audio chunk from persistent storage using session key
      const storageKey = `${sessionId}-${chunkIdNum}`;

      if (!audioChunksStorage.has(storageKey)) {
        console.error(
          `Audio chunk ${storageKey} not found in storage. Available chunks:`,
          Array.from(audioChunksStorage.keys()),
        );
        return res
          .status(404)
          .json({ success: false, error: `Audio chunk ${chunkId} not found` });
      }

      const audioUrl = audioChunksStorage.get(storageKey);
      if (!audioUrl) {
        return res.status(500).json({
          success: false,
          error: `Audio chunk ${chunkId} data corrupted`,
        });
      }

      console.log(
        `Retrieved audio chunk ${storageKey}, URL length: ${audioUrl.length}`,
      );

      res.json({
        success: true,
        audioUrl: audioUrl,
      });
    } catch (error) {
      console.error(
        `Error retrieving audio chunk ${req.params.sessionId}/${req.params.chunkId}:`,
        error,
      );
      res.status(500).json({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to retrieve audio chunk",
      });
    }
  });

  // Test connection endpoint
  app.get("/api/test-connection", async (req, res) => {
    try {
      // 🚀 Use abstracted AI service
      const testResult = await testAIConnection();
      
      res.json({
        success: testResult.success,
        status: testResult.success ? "Connected" : "Failed",
        provider: testResult.provider,
        ...(testResult.error && { error: testResult.error }),
      });
    } catch (error) {
      console.error("Connection test failed:", error);
      res.status(500).json({
        success: false,
        error:
          error instanceof Error ? error.message : "Connection test failed",
      });
    }
  });

  // Text-to-speech endpoint
  app.post("/api/tts", async (req, res) => {
    try {
      const { text, voiceConfig, provider } = req.body;

      if (!text) {
        return res.status(400).json({ 
          success: false, 
          error: "Text is required" 
        });
      }

      console.log("TTS request received:", {
        text: text?.substring(0, 50) + "...",
        configuredProvider: AI_CONFIG.TTS_PROVIDER,
        requestedProvider: provider,
        voiceConfig: voiceConfig ? Object.keys(voiceConfig) : 'none',
        hasGoogleKey: !!process.env.GOOGLE_CLOUD_TTS_API_KEY,
        hasElevenLabsKey: !!process.env.ELEVENLABS_API_KEY
      });

      // 🚀 Use abstracted TTS service
      const ttsResult = await generateTTS(text, voiceConfig);

      console.log("TTS success:", {
        provider: ttsResult.provider,
        audioUrlLength: ttsResult.audioUrl?.length || 0,
        audioUrlPrefix: ttsResult.audioUrl?.substring(0, 50) || 'empty'
      });

      res.json({
        success: true,
        audioUrl: ttsResult.audioUrl,
        provider: ttsResult.provider,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "TTS service error";
      const errorDetails = {
        message: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
        configuredProvider: AI_CONFIG.TTS_PROVIDER,
        fallbackProvider: AI_CONFIG.TTS_FALLBACK,
        hasGoogleKey: !!process.env.GOOGLE_CLOUD_TTS_API_KEY,
        hasElevenLabsKey: !!process.env.ELEVENLABS_API_KEY
      };
      
      console.error("TTS Error Details:", errorDetails);
      console.error("Full error object:", error);
      
      res.status(500).json({
        success: false,
        error: errorMessage,
        details: process.env.NODE_ENV === 'development' ? errorDetails : undefined
      });
    }
  });

  // Audio chunk retrieval endpoint
  app.get("/api/audio-chunk/:chunkId", (req, res) => {
    try {
      const chunkId = parseInt(req.params.chunkId);

      if (
        !(global as any).audioChunks ||
        !(global as any).audioChunks.has(chunkId)
      ) {
        return res.status(404).json({ error: "Audio chunk not found" });
      }

      const audioUrl = (global as any).audioChunks.get(chunkId);
      res.json({ success: true, audioUrl });

      // Clean up after retrieval
      (global as any).audioChunks.delete(chunkId);
    } catch (error) {
      console.error("Error retrieving audio chunk:", error);
      res.status(500).json({ error: "Failed to retrieve audio chunk" });
    }
  });

  // M4A format detection using magic bytes
  function detectM4AFormat(base64Audio: string): boolean {
    try {
      // M4A files start with 'ftyp' at offset 4
      // In base64, this appears as specific patterns
      const buffer = Buffer.from(base64Audio.substring(0, 32), "base64");
      const header = buffer.toString("hex");

      // Check for M4A/MP4 file signatures
      const m4aSignatures = [
        "667479704d344120", // ftyp M4A
        "6674797069736f6d", // ftyp isom
        "667479706d703432", // ftyp mp42
        "667479706d703431", // ftyp mp41
      ];

      return m4aSignatures.some((sig) => header.includes(sig));
    } catch (error) {
      console.warn("M4A detection error:", error);
      return false;
    }
  }

  // Convert M4A to WAV using FFmpeg
  async function convertM4AToWAV(
    base64Audio: string,
  ): Promise<{ base64Audio: string }> {
    return new Promise((resolve, reject) => {
      const tempFileName = `audio_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      const tempInputFile = path.join(os.tmpdir(), `${tempFileName}.m4a`);
      const tempOutputFile = path.join(os.tmpdir(), `${tempFileName}.wav`);

      let conversionTimeout: NodeJS.Timeout;

      try {
        // Decode base64 and write to temp file
        const audioBuffer = Buffer.from(base64Audio, "base64");
        fs.writeFileSync(tempInputFile, audioBuffer);

        // Set up timeout protection
        conversionTimeout = setTimeout(() => {
          console.warn("FFmpeg conversion timeout");
          reject(new Error("Conversion timeout"));
        }, 5000);

        // Convert using FFmpeg
        ffmpeg(tempInputFile)
          .audioCodec("pcm_s16le")
          .audioFrequency(16000)
          .audioChannels(1)
          .format("wav")
          .on("end", () => {
            try {
              clearTimeout(conversionTimeout);

              // Read converted file and encode to base64
              const convertedBuffer = fs.readFileSync(tempOutputFile);
              const convertedBase64 = convertedBuffer.toString("base64");

              // Cleanup temp files
              fs.unlinkSync(tempInputFile);
              fs.unlinkSync(tempOutputFile);

              resolve({ base64Audio: convertedBase64 });
            } catch (readError) {
              console.error("Error reading converted file:", readError);
              reject(readError);
            }
          })
          .on("error", (err) => {
            clearTimeout(conversionTimeout);
            console.error("FFmpeg conversion error:", err);

            // Cleanup temp files
            try {
              if (fs.existsSync(tempInputFile)) fs.unlinkSync(tempInputFile);
              if (fs.existsSync(tempOutputFile)) fs.unlinkSync(tempOutputFile);
            } catch (cleanupError) {
              console.warn("Cleanup error:", cleanupError);
            }

            reject(err);
          })
          .save(tempOutputFile);
      } catch (error) {
        clearTimeout(conversionTimeout);
        console.error("M4A conversion setup error:", error);

        // Cleanup temp files
        try {
          if (fs.existsSync(tempInputFile)) fs.unlinkSync(tempInputFile);
          if (fs.existsSync(tempOutputFile)) fs.unlinkSync(tempOutputFile);
        } catch (cleanupError) {
          console.warn("Cleanup error:", cleanupError);
        }

        reject(error);
      }
    });
  }

  // Enhanced language detection helper
  function detectLanguage(text: string): "hindi" | "hinglish" | "english" {
    const hindiChars = /[\u0900-\u097F]/g;
    const englishWords = /\b[a-zA-Z]+\b/g;

    const hindiMatches = text.match(hindiChars)?.length || 0;
    const englishMatches = text.match(englishWords)?.length || 0;
    const totalChars = text.length;

    // Calculate percentage of Hindi characters
    const hindiPercentage = hindiMatches / totalChars;

    console.log(
      `Language detection: Hindi chars: ${hindiMatches}, English words: ${englishMatches}, Hindi %: ${hindiPercentage.toFixed(2)}`,
    );

    // If more than 20% Hindi characters, it's Hindi or Hinglish
    if (hindiMatches > 0) {
      // If substantial English content alongside Hindi, it's Hinglish
      if (englishMatches > 3 && hindiPercentage < 0.7) {
        console.log("Detected: Hinglish");
        return "hinglish";
      }
      console.log("Detected: Hindi");
      return "hindi";
    }

    // Check for romanized Hindi words
    const romanizedHindi =
      /\b(hai|hain|ke|mein|aur|kya|kaise|kahan|kyun|lekin|phir|ab|yeh|voh|main|tum|hum|koi|sab|kuch|bahut|bhi|kar|kya|agar|jab|tab|fir|nahin|nahi|achha|theek|samjha|samjhi)\b/gi;
    if (romanizedHindi.test(text)) {
      console.log("Detected: Hinglish (romanized)");
      return "hinglish";
    }

    console.log("Detected: English");
    return "english";
  }

  // ElevenLabs TTS function
  async function generateElevenLabsTTS(
    text: string,
    voiceConfig: any,
  ): Promise<string> {
          const apiKey = process.env.ELEVENLABS_API_KEY;
      if (!apiKey) {
        throw new Error("ElevenLabs API key not configured");
      }

      // Preprocess text to replace mathematical symbols with pronounceable words + pauses
      // Order matters - more specific patterns first
      const processedText = text
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

      // Use environment variable for voice ID with fallback
      const voiceId = process.env.ELEVENLABS_VOICE_ID || "FIIBqolBA6JRqu2Lzpd7";
    console.log(
      `Using Hindi voice (Lily) for all content: "${processedText.substring(0, 30)}..."`,
    );
    console.log(`Voice ID: ${voiceId}`);
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
          text: processedText,
          model_id: "eleven_multilingual_v2", // Better for Hindi pronunciation
          voice_settings: {
            stability: 0.7, // Higher stability for clearer Hindi pronunciation
            similarity_boost: 0.8, // Better voice similarity for Hindi
            style: 0.1, // Slight style for more natural speech
            use_speaker_boost: true,
          },
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

      // Check if it's a quota error and provide helpful info
      if (response.status === 401 && errorText.includes("quota_exceeded")) {
        console.log(
          "ElevenLabs quota exceeded - consider upgrading plan for longer responses",
        );
      }

      throw new Error(
        `ElevenLabs API error: ${response.status} - ${errorText}`,
      );
    }
    // Convert to base64 for Safari compatibility
    const arrayBuffer = await response.arrayBuffer();
    const base64Audio = Buffer.from(arrayBuffer).toString("base64");

    // Use audio/mpeg for better Safari compatibility
    return `data:audio/mpeg;base64,${base64Audio}`;
  }

  // Google TTS function (fallback)
  async function generateGoogleTTS(
    text: string,
    voiceConfig: any,
  ): Promise<string> {
    const apiKey = process.env.GOOGLE_CLOUD_TTS_API_KEY;
    if (!apiKey) {
      throw new Error("Google Cloud TTS API key not configured");
    }

    const defaultVoiceConfig = {
      voiceName: "hi-IN-Wavenet-A",
      languageCode: "hi-IN",
      speakingRate: 0.85,
      ...voiceConfig,
    };

    const ttsResponse = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input: { text },
          voice: {
            languageCode: defaultVoiceConfig.languageCode,
            name: defaultVoiceConfig.voiceName,
          },
          audioConfig: {
            audioEncoding: "MP3",
            speakingRate: defaultVoiceConfig.speakingRate,
          },
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

    // Use audio/mpeg for better Safari compatibility
    return `data:audio/mpeg;base64,${ttsData.audioContent}`;
  }

  // Speech-to-text endpoint with M4A conversion
  app.post("/api/speech-to-text", async (req, res) => {
    let tempInputFile: string | null = null;
    let tempOutputFile: string | null = null;

    try {
      const {
        audio,
        language = "en-US",
        mimeType = "audio/webm;codecs=opus",
      } = req.body;

      console.log("Speech-to-text request:", {
        language,
        audioSize: audio?.length,
        mimeType,
      });

      if (!audio) {
        return res.status(400).json({ 
          success: false,
          error: "Audio data is required",
          status: 400
        });
      }

      // Check file size limit (10MB)
      const audioBuffer = Buffer.from(audio, "base64");
      if (audioBuffer.length > 10 * 1024 * 1024) {
        console.warn(`🚫 Audio file too large: ${Math.round(audioBuffer.length / 1024 / 1024 * 100) / 100}MB (max 10MB)`);
        return res.status(400).json({ 
          success: false,
          error: "Audio file too large (max 10MB)",
          status: 400,
          actualSize: Math.round(audioBuffer.length / 1024 / 1024 * 100) / 100 + "MB"
        });
      }

      // Call Google Cloud Speech-to-Text API
      const apiKey = process.env.GOOGLE_CLOUD_SPEECH_API_KEY || process.env.GOOGLE_CLOUD_TTS_API_KEY;

      let processedAudio = audio;
      let encoding = "WEBM_OPUS";
      let sampleRateHertz = 48000;

      // Detect M4A format and convert if needed
      const isM4A =
        detectM4AFormat(audio) ||
        mimeType.includes("mp4") ||
        mimeType.includes("m4a");

      if (isM4A) {
        console.log("M4A format detected, converting to WAV...");
        try {
          const convertedAudio = await convertM4AToWAV(audio);
          processedAudio = convertedAudio.base64Audio;
          encoding = "LINEAR16";
          sampleRateHertz = 16000;
          console.log("M4A conversion successful");
        } catch (conversionError) {
          console.warn(
            "M4A conversion failed, trying original audio:",
            conversionError,
          );
          // Fallback to original audio with M4A encoding
          encoding = "MP4";
          sampleRateHertz = 44100;
        }
      } else if (mimeType.includes("wav")) {
        encoding = "LINEAR16";
        sampleRateHertz = 44100;
      } else if (mimeType.includes("webm")) {
        encoding = "WEBM_OPUS";
        sampleRateHertz = 48000;
      } else {
        encoding = "ENCODING_UNSPECIFIED";
        sampleRateHertz = 16000;
      }

      console.log(
        "Using encoding:",
        encoding,
        "sampleRate:",
        sampleRateHertz,
        "for mimeType:",
        mimeType,
      );

      const speechResponse = await fetch(
        `https://speech.googleapis.com/v1/speech:recognize?key=${apiKey}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            config: {
              encoding: encoding,
              sampleRateHertz: sampleRateHertz,
              languageCode: language,
              enableAutomaticPunctuation: true,
            },
            audio: {
              content: processedAudio,
            },
          }),
        },
      );

      if (!speechResponse.ok) {
        const errorText = await speechResponse.text();
        console.error(
          "Google Speech API error:",
          speechResponse.status,
          errorText,
        );
        throw new Error(
          `Speech recognition API error: ${speechResponse.status} - ${errorText}`,
        );
      }

      const speechData = await speechResponse.json();
      console.log(
        "Google Speech API response:",
        JSON.stringify(speechData, null, 2),
      );

      // Extract transcript from response
      const transcript =
        speechData.results?.[0]?.alternatives?.[0]?.transcript || "";

      console.log("Extracted transcript:", transcript);

      res.json({
        success: true,
        transcript: transcript,
      });
    } catch (error) {
      console.error("Error in speech-to-text:", error);
      res.status(500).json({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Speech recognition service error",
      });
    } finally {
      // Cleanup temporary files
      if (tempInputFile) {
        try {
          fs.unlinkSync(tempInputFile);
        } catch (cleanupError) {
          console.warn("Failed to cleanup temp input file:", cleanupError);
        }
      }
      if (tempOutputFile) {
        try {
          fs.unlinkSync(tempOutputFile);
        } catch (cleanupError) {
          console.warn("Failed to cleanup temp output file:", cleanupError);
        }
      }
    }
  });

  // Serve mobile web app
  app.get("/mobile", (_req, res) => {
    const mobilePath = path.join(__dirname, "../mobile-web-app.html");
    res.sendFile(mobilePath);
  });

  // Legacy proxy routes (fallback)
  const BACKEND_URL = "https://learnline-ai-tutor-production.up.railway.app";

  // Proxy legacy ask-teacher endpoint (fallback)
  app.post("/api/proxy/ask-teacher", async (req, res) => {
    try {
      const response = await fetch(`${BACKEND_URL}/ask-teacher`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(req.body),
      });

      if (!response.ok) {
        throw new Error(`Backend error: ${response.status}`);
      }

      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.error("Error proxying ask-teacher request:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Internal server error",
      });
    }
  });

  // Proxy Google TTS endpoint (fallback)
  app.post("/api/proxy/google-tts", async (req, res) => {
    try {
      const response = await fetch(`${BACKEND_URL}/google-tts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(req.body),
      });

      if (!response.ok) {
        throw new Error(`Backend error: ${response.status}`);
      }

      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.error("Error proxying google-tts request:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Internal server error",
      });
    }
  });

  // Proxy test endpoints (fallback)
  app.post("/api/proxy/test-google-auth", async (req, res) => {
    try {
      const response = await fetch(`${BACKEND_URL}/test-google-auth`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(req.body),
      });

      if (!response.ok) {
        throw new Error(`Backend error: ${response.status}`);
      }

      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.error("Error proxying test-google-auth request:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Internal server error",
      });
    }
  });

  // Proxy health check
  app.get("/api/backend-health", async (req, res) => {
    try {
      const response = await fetch(`${BACKEND_URL}/health`);

      if (!response.ok) {
        throw new Error(`Backend error: ${response.status}`);
      }

      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.error("Error checking backend health:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Backend unavailable",
      });
    }
  });

  const httpServer = createServer(app);
  
  // 🎤 Setup Socket.IO for VAD audio streaming
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: "*", // Configure properly for production
      methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling']
  });

  // Store active VAD sessions
  const vadSessions = new Map<string, ConversationVAD>();

  io.on("connection", async (socket) => {
    console.log(`🔌 Client connected: ${socket.id}`);
    
    // Initialize enhanced VAD with Silero ONNX + Custom fallback
    const vadConfig = getOptimalVADConfig({
      language: 'mixed',
      environment: 'variable', 
      sensitivity: 'medium'
    });
    
    const vad = createVADInstance({
      ...vadConfig,
      sampleRate: 16000,
      provider: 'auto', // Auto-select between Silero and Custom
      customVADEnabled: true // Keep custom VAD as fallback
    });
    
    // Initialize the VAD service (this will try Silero first, fallback to Custom)
    try {
      await vad.initialize();
      console.log(`✅ VAD initialized for ${socket.id} with provider: ${vad.getCurrentProvider()}`);
    } catch (error) {
      console.error(`❌ VAD initialization failed for ${socket.id}:`, error);
      socket.emit('error', { message: 'VAD initialization failed' });
      return;
    }

    vadSessions.set(socket.id, vad);

    // Setup VAD event handlers
    vad.on('speech_start', (event: VADEvent) => {
      console.log(`🎤 Speech started for ${socket.id}`);
      socket.emit('vad_event', { type: 'speech_start', data: event.data });
    });

    vad.on('speech_end', (event: VADEvent) => {
      console.log(`🔇 Speech ended for ${socket.id}`);
      const audioData = vad.getCollectedAudio();
      
      // Send collected audio for processing
      socket.emit('vad_event', { 
        type: 'speech_end', 
        data: { ...event.data, audioBuffer: audioData.toString('base64') }
      });

      // Process the speech with existing AI pipeline
      processCollectedSpeech(audioData, socket, vad);
      
      // Clear buffer for next speech segment
      vad.clearBuffer();
    });

    vad.on('state_change', (event: VADEvent) => {
      console.log(`🔄 State changed for ${socket.id}: ${event.data.state}`);
      socket.emit('conversation_state', { state: event.data.state });
    });

    // Handle incoming audio chunks
    socket.on('audio_chunk', async (data: { audioData: string; timestamp: number; size: number; samples?: number; format?: string }) => {
      try {
        console.log(`📥 Received ${data.format || 'unknown'} audio chunk for ${socket.id}: ${data.samples || 'unknown'} samples, ${data.size} bytes`);
        
        // Convert base64 string back to Buffer
        const audioBuffer = Buffer.from(data.audioData, 'base64');
        
        console.log(`🔊 Processing audio buffer: ${audioBuffer.length} bytes`);
        
        const result = await vad.processAudioChunk(audioBuffer);
        if (result) {
          console.log(`✅ VAD event generated: ${result.type}, probability: ${result.data.probability?.toFixed(3)}`);
          // VAD event was triggered, already handled by event listeners above
        }
      } catch (error) {
        console.error(`❌ Error processing audio for ${socket.id}:`, error);
        socket.emit('error', { message: 'Audio processing failed' });
      }
    });

    // Handle manual state changes
    socket.on('set_conversation_state', (data: { state: ConversationState }) => {
      console.log(`🎯 Manual state change for ${socket.id}: ${data.state}`);
      vad.setConversationState(data.state);
    });

    // Handle VAD provider switching
    socket.on('switch_vad_provider', async (data: { provider: 'silero' | 'custom' }) => {
      try {
        console.log(`🔄 Switching VAD provider for ${socket.id}: ${data.provider}`);
        const success = await vad.switchProvider(data.provider);
        socket.emit('vad_provider_switched', { 
          success, 
          provider: vad.getCurrentProvider(),
          stats: vad.getVADStats()
        });
      } catch (error) {
        console.error(`❌ Failed to switch VAD provider for ${socket.id}:`, error);
        socket.emit('error', { message: 'Failed to switch VAD provider' });
      }
    });

    // Handle VAD stats request
    socket.on('get_vad_stats', () => {
      socket.emit('vad_stats', {
        stats: vad.getVADStats(),
        provider: vad.getCurrentProvider(),
        state: vad.getCurrentState()
      });
    });

    // Handle VAD session reset (clears LSTM states)
    socket.on('reset_vad_session', () => {
      try {
        vad.resetSession();
        socket.emit('vad_session_reset', { 
          success: true,
          timestamp: Date.now()
        });
        console.log(`🔄 VAD session reset for ${socket.id}`);
      } catch (error) {
        console.error(`❌ Failed to reset VAD session for ${socket.id}:`, error);
        socket.emit('error', { message: 'Failed to reset VAD session' });
      }
    });

    // Handle disconnection
    socket.on("disconnect", async () => {
      console.log(`🔌 Client disconnected: ${socket.id}`);
      const vadInstance = vadSessions.get(socket.id);
      if (vadInstance) {
        await vadInstance.destroy();
        vadSessions.delete(socket.id);
      }
    });

    // Send initial connection confirmation with enhanced VAD info
    socket.emit('connected', { 
      sessionId: socket.id, 
      vadProvider: vad.getCurrentProvider(),
      vadStats: vad.getVADStats(),
      vadConfig: {
        sampleRate: 16000,
        model: "v5",
        provider: vad.getCurrentProvider(),
        positiveSpeechThreshold: 0.5,
        negativeSpeechThreshold: 0.35,
        minSpeechDuration: 1000,
        minSilenceDuration: 800,
        sileroReady: vad.getVADStats().sileroReady
      }
    });
  });

  // Function to process collected speech through existing AI pipeline
  async function processCollectedSpeech(audioData: Buffer, socket: any, vad: ConversationVAD) {
    try {
      // Set state to processing
      vad.setConversationState('processing');

      // Convert audio to the format expected by speech-to-text
      const tempDir = os.tmpdir();
      const tempAudioPath = path.join(tempDir, `speech_${Date.now()}.wav`);
      
      // Write audio buffer to temporary file
      fs.writeFileSync(tempAudioPath, audioData);

      // Convert to base64 for existing STT pipeline
      const base64Audio = fs.readFileSync(tempAudioPath, { encoding: 'base64' });
      
      // Clean up temp file
      fs.unlinkSync(tempAudioPath);

      // Use existing speech-to-text processing logic
      // (This integrates with the existing /api/speech-to-text logic)
      const sttResult = await processSTT(base64Audio);
      
      if (sttResult.success && sttResult.transcript) {
        console.log(`📝 Transcribed: ${sttResult.transcript}`);
        socket.emit('transcription', { text: sttResult.transcript });

        // Process with AI teacher (using existing streaming logic)
        await processAITeacher(sttResult.transcript, socket, vad);
      } else {
        socket.emit('error', { message: 'Speech recognition failed' });
        vad.setConversationState('idle');
      }

    } catch (error) {
      console.error('❌ Error processing collected speech:', error);
      socket.emit('error', { message: 'Speech processing failed' });
      vad.setConversationState('idle');
    }
  }

  // Function to process AI response using existing streaming logic
  async function processAITeacher(question: string, socket: any, vad: ConversationVAD) {
    try {
      vad.setConversationState('speaking');
      
      const sessionId = generateSessionId();
      let fullResponse = '';
      
      // Use existing AI streaming logic
      const aiResponse = await generateAIResponse(question, SYSTEM_PROMPTS.HINDI_TEACHER_BASE, true);
      
      if (!('stream' in aiResponse)) {
        throw new Error('Expected streaming response');
      }

      for await (const chunk of aiResponse.stream) {
        fullResponse += chunk;
        socket.emit('ai_response_chunk', { text: chunk });
        
        // Generate TTS for chunk (using existing TTS logic)
        try {
          const ttsResult = await generateTTS(chunk, { languageCode: 'hi-IN' });
          if (ttsResult.audioUrl) {
            socket.emit('tts_chunk', { 
              text: chunk,
              audioUrl: ttsResult.audioUrl
            });
          }
        } catch (ttsError) {
          console.error('TTS generation failed for chunk:', ttsError);
        }
      }

      socket.emit('ai_response_complete', { fullText: fullResponse });
      vad.setConversationState('idle'); // Ready for next conversation

    } catch (error) {
      console.error('❌ Error processing AI response:', error);
      socket.emit('error', { message: 'AI processing failed' });
      vad.setConversationState('idle');
    }
  }

  // STT processing using existing speech-to-text logic
  async function processSTT(base64Audio: string) {
    try {
      // Use the existing Google Speech-to-Text integration
      const apiKey = process.env.GOOGLE_CLOUD_SPEECH_API_KEY || process.env.GOOGLE_CLOUD_TTS_API_KEY;

      // Call Google Speech-to-Text API directly (same logic as /api/speech-to-text)
      const sttResponse = await fetch(
        `https://speech.googleapis.com/v1/speech:recognize?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            config: {
              encoding: "LINEAR16", // Assuming we converted to WAV
              sampleRateHertz: 16000, // VAD uses 16kHz
              languageCode: "hi-IN", // Hindi for our education app
            },
            audio: { content: base64Audio },
          }),
        }
      );

      if (!sttResponse.ok) {
        const errorData = await sttResponse.json().catch(() => ({}));
        throw new Error(`Google STT API error: ${sttResponse.status} - ${errorData.error?.message || 'Unknown error'}`);
      }

      const sttData = await sttResponse.json();
      
      if (!sttData.results || sttData.results.length === 0) {
        return {
          success: false,
          transcript: null,
          error: "No speech detected"
        };
      }

      const transcript = sttData.results
        .map((result: any) => result.alternatives?.[0]?.transcript)
        .filter(Boolean)
        .join(" ");

      console.log('🎤 STT Result:', transcript);
      
      return {
        success: true,
        transcript: transcript || null
      };

    } catch (error) {
      console.error('❌ STT processing failed:', error);
      return {
        success: false,
        transcript: null,
        error: error instanceof Error ? error.message : 'STT processing failed'
      };
    }
  }
  
  return httpServer;
}
