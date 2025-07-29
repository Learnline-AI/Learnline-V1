import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { ChatMessage, AudioQueueState } from '../types';

interface ChatBubbleProps {
  message: ChatMessage;
  isPlaying?: boolean;
  onStopAudio?: () => void;
  queueState?: AudioQueueState;
}

export function ChatBubble({ message, isPlaying, onStopAudio, queueState }: ChatBubbleProps) {
  const isStudent = message.type === 'student';
  
  const renderAudioStatus = () => {
    if (!isPlaying || !queueState) return null;

    return (
      <View style={styles.audioStatusContainer}>
        <View style={styles.audioStatusContent}>
          <Text style={styles.audioStatusText}>
            🔊 Playing chunk {queueState.currentChunkIndex + 1} of {queueState.totalChunks}
          </Text>
          <TouchableOpacity
            style={styles.stopButton}
            onPress={onStopAudio}
          >
            <Text style={styles.stopButtonText}>⏹️ Stop</Text>
          </TouchableOpacity>
        </View>
        
        {/* Progress indicator */}
        <View style={styles.progressContainer}>
          <View 
            style={[
              styles.progressBar,
              { 
                width: `${((queueState.currentChunkIndex + 1) / queueState.totalChunks) * 100}%` 
              }
            ]}
          />
        </View>
      </View>
    );
  };
  
  return (
    <View style={[
      styles.container,
      isStudent ? styles.studentContainer : styles.aiContainer
    ]}>
      <View style={[
        styles.bubble,
        isStudent ? styles.studentBubble : styles.aiBubble,
        isPlaying && styles.playingBubble
      ]}>
        <Text style={[
          styles.text,
          isStudent ? styles.studentText : styles.aiText
        ]}>
          {message.content}
        </Text>
        
        {/* Audio status for AI messages */}
        {!isStudent && renderAudioStatus()}
        
        <Text style={styles.timestamp}>
          {new Date(message.timestamp).toLocaleTimeString([], { 
            hour: '2-digit', 
            minute: '2-digit' 
          })}
        </Text>
      </View>
    </View>
  );
}

export function TypingIndicator() {
  return (
    <View style={[styles.container, styles.aiContainer]}>
      <View style={[styles.bubble, styles.aiBubble]}>
        <Text style={styles.typingText}>
          टाइप कर रहे हैं... • Typing...
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 8,
    paddingHorizontal: 20,
  },
  studentContainer: {
    alignItems: 'flex-end',
  },
  aiContainer: {
    alignItems: 'flex-start',
  },
  bubble: {
    maxWidth: '85%',
    padding: 16,
    borderRadius: 20,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  studentBubble: {
    backgroundColor: '#007AFF',
    borderBottomRightRadius: 6,
  },
  aiBubble: {
    backgroundColor: '#F0F0F0',
    borderBottomLeftRadius: 6,
  },
  playingBubble: {
    backgroundColor: '#E8F5E8',
    borderColor: '#4CAF50',
    borderWidth: 1,
  },
  text: {
    fontSize: 16,
    lineHeight: 22,
  },
  studentText: {
    color: '#FFFFFF',
  },
  aiText: {
    color: '#1D1D1F',
  },
  audioStatusContainer: {
    marginTop: 12,
    padding: 8,
    backgroundColor: '#F8F8F8',
    borderRadius: 8,
    borderColor: '#E0E0E0',
    borderWidth: 1,
  },
  audioStatusContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  audioStatusText: {
    fontSize: 12,
    color: '#4CAF50',
    fontWeight: '600',
  },
  stopButton: {
    backgroundColor: '#FF5722',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  stopButtonText: {
    fontSize: 10,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  progressContainer: {
    height: 3,
    backgroundColor: '#E0E0E0',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#4CAF50',
    borderRadius: 2,
  },
  timestamp: {
    fontSize: 11,
    color: '#8E8E93',
    marginTop: 4,
    alignSelf: 'flex-end',
  },
  typingText: {
    color: '#8E8E93',
    fontStyle: 'italic',
    fontSize: 14,
  },
});