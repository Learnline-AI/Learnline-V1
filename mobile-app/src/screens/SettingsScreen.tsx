import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  Switch,
  ScrollView,
} from 'react-native';

interface SettingsScreenProps {
  onBack: () => void;
}

export default function SettingsScreen({ onBack }: SettingsScreenProps) {
  const [language, setLanguage] = useState<'hindi' | 'english' | 'hinglish'>('hindi');
  const [speechRate, setSpeechRate] = useState(0.8);
  const [voiceType, setVoiceType] = useState('female');
  const [offlineMode, setOfflineMode] = useState(false);

  const languageOptions = [
    { value: 'hindi', label: 'हिंदी (Hindi)' },
    { value: 'english', label: 'English' },
    { value: 'hinglish', label: 'Hinglish (Mix)' },
  ];

  const voiceOptions = [
    { value: 'female', label: 'Female Voice' },
    { value: 'male', label: 'Male Voice' },
  ];

  const speechRateOptions = [
    { value: 0.6, label: 'Slow (धीमा)' },
    { value: 0.8, label: 'Normal (सामान्य)' },
    { value: 1.0, label: 'Fast (तेज)' },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
      </View>

      <ScrollView style={styles.content}>
        {/* Language Selection */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Language • भाषा</Text>
          {languageOptions.map((option) => (
            <TouchableOpacity
              key={option.value}
              style={[
                styles.option,
                language === option.value && styles.selectedOption,
              ]}
              onPress={() => setLanguage(option.value as any)}
            >
              <Text style={[
                styles.optionText,
                language === option.value && styles.selectedOptionText,
              ]}>
                {option.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Voice Type */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Voice Type • आवाज़ का प्रकार</Text>
          {voiceOptions.map((option) => (
            <TouchableOpacity
              key={option.value}
              style={[
                styles.option,
                voiceType === option.value && styles.selectedOption,
              ]}
              onPress={() => setVoiceType(option.value)}
            >
              <Text style={[
                styles.optionText,
                voiceType === option.value && styles.selectedOptionText,
              ]}>
                {option.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Speech Rate */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Speech Rate • बोलने की गति</Text>
          {speechRateOptions.map((option) => (
            <TouchableOpacity
              key={option.value}
              style={[
                styles.option,
                speechRate === option.value && styles.selectedOption,
              ]}
              onPress={() => setSpeechRate(option.value)}
            >
              <Text style={[
                styles.optionText,
                speechRate === option.value && styles.selectedOptionText,
              ]}>
                {option.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Offline Mode */}
        <View style={styles.section}>
          <View style={styles.switchRow}>
            <View style={styles.switchLabel}>
              <Text style={styles.sectionTitle}>Offline Mode</Text>
              <Text style={styles.switchDescription}>
                ऑफ़लाइन मोड में कैश्ड उत्तर का उपयोग करें
              </Text>
            </View>
            <Switch
              value={offlineMode}
              onValueChange={setOfflineMode}
              trackColor={{ false: '#E5E5EA', true: '#007AFF' }}
              thumbColor={offlineMode ? '#FFFFFF' : '#FFFFFF'}
            />
          </View>
        </View>

        {/* About Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>About • जानकारी</Text>
          <View style={styles.aboutContainer}>
            <Text style={styles.aboutText}>
              AI शिक्षक - Class 9 Science Learning App
            </Text>
            <Text style={styles.aboutText}>
              Version 1.0.0
            </Text>
            <Text style={styles.aboutText}>
              Powered by Advanced AI Technology
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5EA',
    backgroundColor: '#F8F9FA',
  },
  backButton: {
    padding: 8,
  },
  backButtonText: {
    fontSize: 16,
    color: '#007AFF',
    fontWeight: '500',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1D1D1F',
    marginLeft: 16,
  },
  content: {
    flex: 1,
  },
  section: {
    paddingHorizontal: 16,
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5EA',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1D1D1F',
    marginBottom: 12,
  },
  option: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  selectedOption: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  optionText: {
    fontSize: 16,
    color: '#1D1D1F',
  },
  selectedOptionText: {
    color: '#FFFFFF',
    fontWeight: '500',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  switchLabel: {
    flex: 1,
  },
  switchDescription: {
    fontSize: 14,
    color: '#8E8E93',
    marginTop: 4,
  },
  aboutContainer: {
    paddingVertical: 8,
  },
  aboutText: {
    fontSize: 14,
    color: '#8E8E93',
    marginBottom: 4,
    textAlign: 'center',
  },
});