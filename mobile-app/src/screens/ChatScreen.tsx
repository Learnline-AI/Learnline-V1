// ChatScreen.tsx
// CURRENT STATE: Push-to-talk → STT → AI response flow (WORKING ✅)  
// CONVERSATIONAL TARGET: Continuous conversation with auto turn-taking
// KEY STRENGTHS: Streaming responses, auto-audio-playback, error handling
// MODIFICATIONS NEEDED: Replace manual recording with VAD, add conversation states

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  SafeAreaView,
  Alert,
  Platform,
  StatusBar,
  TouchableOpacity,
  Animated,
  Dimensions,
} from 'react-native';

// Generate unique IDs to prevent React key conflicts
let messageIdCounter = 0;
const generateUniqueMessageId = () => {
  messageIdCounter++;
  return `msg_${Date.now()}_${messageIdCounter}`;
};
import { ChatMessage, UserSettings } from '../types';
import { ChatBubble, TypingIndicator } from '../components/ChatBubble';
import { VoiceButton, VoiceLevel } from '../components/VoiceButton';
import { useAudioRecording } from '../hooks/useAudioRecording';
import { useAudioPlayback } from '../hooks/useAudioPlayback';
import { apiService } from '../services/apiService';

const { width, height } = Dimensions.get('window');

export default function ChatScreen() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [language, setLanguage] = useState<'hindi' | 'english'>('hindi');
  const [conversationStarted, setConversationStarted] = useState(false);
  const scrollViewRef = useRef<ScrollView>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const { queueState, addChunkToQueue, stopAudio } = useAudioPlayback();
  const { isRecording, startRecording, stopRecording } = useAudioRecording({
    onRecordingComplete: handleRecordingComplete,
    maxDuration: 30000, // 30 seconds max
  });

  useEffect(() => {
    if (!conversationStarted) {
      initializeConversation();
    }
  }, [conversationStarted]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping]);

  useEffect(() => {
    if (error) {
      Animated.sequence([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.delay(3000),
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start(() => setError(null));
    }
  }, [error]);

  const scrollToBottom = () => {
    scrollViewRef.current?.scrollToEnd({ animated: true });
  };

  const initializeConversation = () => {
    const welcomeMessage: ChatMessage = {
      id: generateUniqueMessageId(),
      type: 'ai',
      content: language === 'hindi' 
        ? 'नमस्ते! मैं रवि भाई हूँ, आपका AI शिक्षक। Class 9 Science के बारे में कोई भी सवाल पूछिए!'
        : 'Hello! I am Ravi Bhaiya, your AI teacher. Ask me anything about Class 9 Science!',
      timestamp: new Date(),
    };
    
    setMessages([welcomeMessage]);
    setConversationStarted(true);
  };

  async function handleRecordingComplete(audioUri: string) {
    try {
      setIsTyping(true);
      setError(null);

      console.log('Processing audio recording:', audioUri);
      console.log('Audio recording details:', {
        uri: audioUri,
        timestamp: new Date().toISOString()
      });

      // Call mobile-specific speech-to-text API
      const sttResponse = await apiService.speechToTextFromUri(audioUri);
      
      console.log('STT Response received:', {
        success: sttResponse.success,
        hasText: !!sttResponse.data?.text,
        textLength: sttResponse.data?.text?.length || 0,
        error: sttResponse.error
      });

      if (!sttResponse.success) {
        const errorMsg = sttResponse.error || 'Speech recognition failed';
        console.error('Speech-to-text failed:', errorMsg);
        
        setError(language === 'hindi' 
          ? `आवाज़ पहचानने में समस्या: ${errorMsg}`
          : `Speech recognition error: ${errorMsg}`);
        setIsTyping(false);
        return;
      }

      if (!sttResponse.data?.text?.trim()) {
        console.warn('Empty transcript received');
        setError(language === 'hindi' 
          ? 'मैं आपकी आवाज़ समझ नहीं सका। कृपया धीरे और स्पष्ट बोलें।'
          : 'I could not understand your speech. Please speak slowly and clearly.');
        setIsTyping(false);
        return;
      }

      const recognizedText = sttResponse.data.text.trim();
      console.log('Recognized text:', recognizedText);
      
      // Add student message
      const studentMessage: ChatMessage = {
        id: generateUniqueMessageId(),
        type: 'student',
        content: recognizedText,
        timestamp: new Date(),
      };
      
      setMessages(prev => {
        // Prevent duplicate messages by checking existing IDs
        const existingIds = new Set(prev.map(msg => msg.id));
        if (existingIds.has(studentMessage.id)) {
          console.warn('Duplicate message ID detected, regenerating:', studentMessage.id);
          studentMessage.id = generateUniqueMessageId();
        }
        return [...prev, studentMessage];
      });

      // Get AI response with streaming
      let aiResponse = '';
      const aiMessageId = generateUniqueMessageId();
      
      console.log('Starting AI teacher stream for question:', recognizedText);
      
      apiService.askTeacherStream(
        recognizedText,
        (text) => {
          aiResponse += text;
        },
        async (chunkId, text, audioUrl) => {
          // Handle audio chunks - add to queue for auto-play
          console.log('Audio chunk received:', { chunkId, textLength: text.length, audioUrl: !!audioUrl });
          
          const audioChunk = {
            id: chunkId,
            text: text,
            audioUrl: audioUrl,
            isLoaded: true,
          };
          
          // Add chunk to queue - auto-play starts immediately
          await addChunkToQueue(aiMessageId, audioChunk);
        },
        (errorMsg) => {
          console.error('AI teacher stream error:', errorMsg);
          setError(language === 'hindi' 
            ? `AI शिक्षक त्रुटि: ${errorMsg}`
            : `AI teacher error: ${errorMsg}`);
          setIsTyping(false);
        },
        () => {
          console.log('AI teacher stream completed, response length:', aiResponse.length);
          setIsTyping(false);
          
          const aiMessage: ChatMessage = {
            id: aiMessageId,
            type: 'ai',
            content: aiResponse || (language === 'hindi' 
              ? 'क्षमा करें, मुझे कुछ समस्या आई। कृपया दोबारा पूछें।'
              : 'Sorry, I encountered an issue. Please ask again.'),
            timestamp: new Date(),
            isPlayingAudio: queueState.isPlaying && queueState.currentMessageId === aiMessageId,
          };
          
          setMessages(prev => {
            // Prevent duplicate messages by checking existing IDs
            const existingIds = new Set(prev.map(msg => msg.id));
            if (existingIds.has(aiMessage.id)) {
              console.warn('Duplicate AI message ID detected, regenerating:', aiMessage.id);
              aiMessage.id = generateUniqueMessageId();
            }
            return [...prev, aiMessage];
          });
        }
      );

    } catch (error) {
      console.error('Recording processing error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      setError(language === 'hindi' 
        ? `रिकॉर्डिंग प्रोसेसिंग त्रुटि: ${errorMessage}`
        : `Recording processing error: ${errorMessage}`);
      setIsTyping(false);
    }
  }

  const toggleLanguage = () => {
    const newLang = language === 'hindi' ? 'english' : 'hindi';
    setLanguage(newLang);
    console.log('Language toggled to:', newLang);
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#FF6B35" />
      
      {/* Modern Header */}
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <View style={styles.avatarContainer}>
            <Text style={styles.avatarText}>🧑‍🏫</Text>
          </View>
          <View style={styles.headerInfo}>
            <Text style={styles.headerTitle}>
              {language === 'hindi' ? 'रवि भाई' : 'Ravi Bhaiya'}
            </Text>
            <Text style={styles.headerSubtitle}>
              {language === 'hindi' ? 'Class 9 Science शिक्षक' : 'Class 9 Science Teacher'}
            </Text>
          </View>
          <TouchableOpacity style={styles.languageButton} onPress={toggleLanguage}>
            <Text style={styles.languageButtonText}>
              {language === 'hindi' ? 'EN' : 'हिं'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Chat Messages */}
      <ScrollView
        ref={scrollViewRef}
        style={styles.chatContainer}
        contentContainerStyle={styles.chatContent}
        showsVerticalScrollIndicator={false}
      >
        {messages.map((message, index) => (
          <ChatBubble
            key={`${message.id}-${index}`}
            message={message}
            isPlaying={queueState.isPlaying && queueState.currentMessageId === message.id}
            onStopAudio={stopAudio}
            queueState={queueState.currentMessageId === message.id ? queueState : undefined}
          />
        ))}
        
        {isTyping && <TypingIndicator />}
        
        {/* Error Message */}
        {error && (
          <Animated.View style={[styles.errorContainer, { opacity: fadeAnim }]}>
            <Text style={styles.errorText}>{error}</Text>
          </Animated.View>
        )}
      </ScrollView>

      {/* Voice Input Section */}
      <View style={styles.inputSection}>
        <View style={styles.voiceContainer}>
          <VoiceLevel isVisible={isRecording} />
          <VoiceButton
            isRecording={isRecording}
            onStartRecording={startRecording}
            onStopRecording={stopRecording}
            disabled={isTyping}
          />
          <Text style={styles.voiceHint}>
            {isRecording 
              ? (language === 'hindi' ? 'सुन रहा हूँ...' : 'Listening...')
              : (language === 'hindi' ? 'बोलने के लिए दबाएं' : 'Tap to speak')
            }
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  header: {
    backgroundColor: '#FF6B35',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  avatarContainer: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#FFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  avatarText: {
    fontSize: 24,
  },
  headerInfo: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFF',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#FFE8E1',
    marginTop: 2,
  },
  languageButton: {
    backgroundColor: '#FFF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  languageButtonText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#FF6B35',
  },
  chatContainer: {
    flex: 1,
  },
  chatContent: {
    padding: 16,
    paddingBottom: 140,
  },
  errorContainer: {
    backgroundColor: '#FFE5E5',
    borderColor: '#FF6B6B',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginVertical: 8,
    marginHorizontal: 16,
    marginBottom: 120,
  },
  errorText: {
    fontSize: 14,
    color: '#D63031',
    textAlign: 'center',
  },
  inputSection: {
    backgroundColor: '#FFF',
    paddingHorizontal: 20,
    paddingVertical: 20,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
  },
  voiceContainer: {
    alignItems: 'center',
  },
  voiceHint: {
    fontSize: 14,
    color: '#666',
    marginTop: 12,
    textAlign: 'center',
  },
});