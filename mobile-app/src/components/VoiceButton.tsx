// VoiceButton.tsx  
// CURRENT STATE: Manual push-to-talk interface (WORKING ✅)
// CONVERSATIONAL TARGET: Will show conversation states (listening/speaking/thinking)
// KEY STRENGTHS: Beautiful animations, clear visual feedback, VoiceLevel component
// MODIFICATIONS NEEDED: Add conversation state indicators, continuous mode visuals

import React, { useRef, useEffect } from 'react';
import { 
  TouchableOpacity, 
  View, 
  StyleSheet, 
  Animated,
  Text,
  Dimensions
} from 'react-native';

const { width } = Dimensions.get('window');

interface VoiceButtonProps {
  isRecording: boolean;
  onStartRecording: () => void;
  onStopRecording: () => void;
  disabled?: boolean;
}

export function VoiceButton({ 
  isRecording, 
  onStartRecording, 
  onStopRecording, 
  disabled 
}: VoiceButtonProps) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (isRecording) {
      // Start pulsing animation
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.2,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 800,
            useNativeDriver: true,
          }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isRecording]);

  const handlePress = () => {
    Animated.sequence([
      Animated.timing(scaleAnim, {
        toValue: 0.9,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 1,
        duration: 100,
        useNativeDriver: true,
      }),
    ]).start();

    if (isRecording) {
      onStopRecording();
    } else {
      onStartRecording();
    }
  };

  return (
    <View style={styles.container}>
      <Animated.View 
        style={[
          styles.pulseRing,
          {
            transform: [{ scale: pulseAnim }],
            opacity: isRecording ? 0.3 : 0,
          }
        ]}
      />
      <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
        <TouchableOpacity
          style={[
            styles.button,
            isRecording && styles.recording,
            disabled && styles.disabled
          ]}
          onPress={handlePress}
          disabled={disabled}
          activeOpacity={0.8}
        >
          <View style={styles.iconContainer}>
            <Text style={[styles.micIcon, isRecording && styles.micIconRecording]}>
              🎤
            </Text>
          </View>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

interface VoiceLevelProps {
  isVisible: boolean;
}

export function VoiceLevel({ isVisible }: VoiceLevelProps) {
  const waveAnims = useRef([
    new Animated.Value(0.3),
    new Animated.Value(0.5),
    new Animated.Value(0.4),
    new Animated.Value(0.6),
    new Animated.Value(0.3),
  ]).current;

  useEffect(() => {
    if (isVisible) {
      const animations = waveAnims.map((anim) =>
        Animated.loop(
          Animated.sequence([
            Animated.timing(anim, {
              toValue: Math.random() * 0.7 + 0.3,
              duration: 200 + Math.random() * 300,
              useNativeDriver: false,
            }),
            Animated.timing(anim, {
              toValue: Math.random() * 0.7 + 0.3,
              duration: 200 + Math.random() * 300,
              useNativeDriver: false,
            }),
          ])
        )
      );

      animations.forEach((animation, index) => {
        setTimeout(() => animation.start(), index * 100);
      });

      return () => {
        animations.forEach(animation => animation.stop());
      };
    } else {
      waveAnims.forEach(anim => anim.setValue(0.3));
    }
  }, [isVisible]);

  if (!isVisible) return null;

  return (
    <View style={styles.waveContainer}>
      {waveAnims.map((anim, index) => (
        <Animated.View
          key={index}
          style={[
            styles.waveBar,
            {
              height: anim.interpolate({
                inputRange: [0, 1],
                outputRange: [4, 32],
              }),
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    width: 120,
    height: 120,
  },
  pulseRing: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#FF6B35',
  },
  button: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#FF6B35',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#FF6B35',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  recording: {
    backgroundColor: '#FF3B30',
    shadowColor: '#FF3B30',
  },
  disabled: {
    backgroundColor: '#C7C7CC',
    shadowColor: '#000',
    shadowOpacity: 0.1,
  },
  iconContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  micIcon: {
    fontSize: 32,
    textAlign: 'center',
  },
  micIconRecording: {
    fontSize: 28,
  },
  waveContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    height: 40,
    position: 'absolute',
    top: -50,
    alignSelf: 'center',
  },
  waveBar: {
    width: 3,
    backgroundColor: '#FF6B35',
    borderRadius: 2,
    marginHorizontal: 2,
  },
});