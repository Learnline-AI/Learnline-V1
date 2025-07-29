import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  ScrollView,
} from 'react-native';

interface ProfileScreenProps {
  onBack: () => void;
}

export default function ProfileScreen({ onBack }: ProfileScreenProps) {
  const [stats] = useState({
    questionsAsked: 47,
    topicsCovered: 12,
    studyTimeMinutes: 125,
    currentStreak: 5,
  });

  const achievements = [
    { title: 'First Question', description: 'Asked your first question', completed: true },
    { title: 'Science Explorer', description: 'Covered 5 topics', completed: true },
    { title: 'Curious Mind', description: 'Asked 25 questions', completed: true },
    { title: 'Study Streak', description: '5 days in a row', completed: true },
    { title: 'Deep Learner', description: 'Study for 2+ hours', completed: false },
  ];

  const recentTopics = [
    'Photosynthesis',
    'Force and Motion',
    'Atomic Structure',
    'Sound Waves',
    'Gravitation',
  ];

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Profile</Text>
      </View>

      <ScrollView style={styles.content}>
        {/* User Info */}
        <View style={styles.userSection}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>👤</Text>
          </View>
          <Text style={styles.userName}>Science Student</Text>
          <Text style={styles.userClass}>Class 9 • कक्षा 9</Text>
        </View>

        {/* Stats */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Learning Stats • सीखने की जानकारी</Text>
          <View style={styles.statsGrid}>
            <View style={styles.statCard}>
              <Text style={styles.statNumber}>{stats.questionsAsked}</Text>
              <Text style={styles.statLabel}>Questions Asked</Text>
              <Text style={styles.statLabelHindi}>प्रश्न पूछे</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statNumber}>{stats.topicsCovered}</Text>
              <Text style={styles.statLabel}>Topics Covered</Text>
              <Text style={styles.statLabelHindi}>विषय कवर किए</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statNumber}>{Math.floor(stats.studyTimeMinutes / 60)}h {stats.studyTimeMinutes % 60}m</Text>
              <Text style={styles.statLabel}>Study Time</Text>
              <Text style={styles.statLabelHindi}>अध्ययन समय</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statNumber}>{stats.currentStreak}</Text>
              <Text style={styles.statLabel}>Day Streak</Text>
              <Text style={styles.statLabelHindi}>दिन की श्रृंखला</Text>
            </View>
          </View>
        </View>

        {/* Achievements */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Achievements • उपलब्धियां</Text>
          {achievements.map((achievement, index) => (
            <View key={index} style={[
              styles.achievementCard,
              achievement.completed && styles.completedAchievement
            ]}>
              <Text style={styles.achievementIcon}>
                {achievement.completed ? '🏆' : '🔒'}
              </Text>
              <View style={styles.achievementContent}>
                <Text style={[
                  styles.achievementTitle,
                  !achievement.completed && styles.lockedText
                ]}>
                  {achievement.title}
                </Text>
                <Text style={[
                  styles.achievementDescription,
                  !achievement.completed && styles.lockedText
                ]}>
                  {achievement.description}
                </Text>
              </View>
            </View>
          ))}
        </View>

        {/* Recent Topics */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recent Topics • हालिया विषय</Text>
          {recentTopics.map((topic, index) => (
            <View key={index} style={styles.topicCard}>
              <Text style={styles.topicText}>{topic}</Text>
            </View>
          ))}
        </View>

        {/* Progress Goals */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Today's Goals • आज के लक्ष्य</Text>
          <View style={styles.goalCard}>
            <Text style={styles.goalText}>Ask 3 questions today</Text>
            <Text style={styles.goalProgress}>2/3 completed</Text>
          </View>
          <View style={styles.goalCard}>
            <Text style={styles.goalText}>Study for 30 minutes</Text>
            <Text style={styles.goalProgress}>25/30 minutes</Text>
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
  userSection: {
    alignItems: 'center',
    paddingVertical: 32,
    backgroundColor: '#F8F9FA',
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#007AFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  avatarText: {
    fontSize: 32,
    color: '#FFFFFF',
  },
  userName: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1D1D1F',
    marginBottom: 4,
  },
  userClass: {
    fontSize: 16,
    color: '#8E8E93',
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
    marginBottom: 16,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  statCard: {
    width: '48%',
    backgroundColor: '#F8F9FA',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  statNumber: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#007AFF',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 14,
    color: '#1D1D1F',
    fontWeight: '500',
  },
  statLabelHindi: {
    fontSize: 12,
    color: '#8E8E93',
  },
  achievementCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#F8F9FA',
    borderRadius: 8,
    marginBottom: 8,
  },
  completedAchievement: {
    backgroundColor: '#E8F5E8',
  },
  achievementIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  achievementContent: {
    flex: 1,
  },
  achievementTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1D1D1F',
    marginBottom: 2,
  },
  achievementDescription: {
    fontSize: 14,
    color: '#8E8E93',
  },
  lockedText: {
    color: '#C7C7CC',
  },
  topicCard: {
    backgroundColor: '#F8F9FA',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  topicText: {
    fontSize: 16,
    color: '#1D1D1F',
  },
  goalCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#F8F9FA',
    borderRadius: 8,
    marginBottom: 8,
  },
  goalText: {
    fontSize: 16,
    color: '#1D1D1F',
  },
  goalProgress: {
    fontSize: 14,
    color: '#007AFF',
    fontWeight: '500',
  },
});