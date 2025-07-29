import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, User, Atom, FlaskConical } from 'lucide-react';
import { LearningStats } from '@/types';
import { storage, STORAGE_KEYS } from '@/lib/storage';

interface ProfilePageProps {
  onBack: () => void;
}

export default function ProfilePage({ onBack }: ProfilePageProps) {
  const [stats, setStats] = useState<LearningStats>({
    questionsAsked: 0,
    topicsCovered: 0,
    studyTimeMinutes: 0,
    currentStreak: 0,
  });

  // Load saved stats
  useEffect(() => {
    const savedStats = storage.getItem<LearningStats>(STORAGE_KEYS.LEARNING_STATS);
    if (savedStats) {
      setStats(savedStats);
    }
  }, []);

  const formatStudyTime = (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  };

  const recentTopics = [
    {
      id: '1',
      title: 'Newton\'s Laws of Motion',
      questionsCount: 5,
      timeAgo: '2h ago',
      icon: Atom,
      color: 'bg-blue-600',
    },
    {
      id: '2',
      title: 'Acids and Bases',
      questionsCount: 3,
      timeAgo: '1d ago',
      icon: FlaskConical,
      color: 'bg-cyan-500',
    },
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Status Bar Simulator */}
      <div className="h-11 bg-white flex items-center justify-between px-4 text-sm font-medium text-gray-900">
        <span>9:41</span>
        <div className="flex items-center gap-1 text-xs">
          <div className="w-4 h-2 border border-gray-400 rounded-sm">
            <div className="w-3/4 h-full bg-gray-900 rounded-sm"></div>
          </div>
        </div>
      </div>

      {/* Profile Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center">
        <Button variant="ghost" size="sm" onClick={onBack} className="mr-2">
          <ArrowLeft className="text-gray-600" size={16} />
        </Button>
        <h1 className="text-lg font-semibold text-gray-900">Profile</h1>
      </header>

      <div className="p-4 space-y-6 pb-24">
        {/* User Info */}
        <div className="text-center">
          <div className="w-20 h-20 bg-gradient-to-br from-blue-600 to-cyan-500 rounded-full mx-auto mb-3 flex items-center justify-center">
            <User className="text-white" size={32} />
          </div>
          <h2 className="text-xl font-semibold text-gray-900">Student</h2>
          <p className="text-gray-500">Class 9 Science Student</p>
        </div>

        {/* Learning Stats */}
        <div className="grid grid-cols-2 gap-4">
          <Card className="bg-blue-50">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-blue-600">{stats.questionsAsked}</div>
              <div className="text-sm text-gray-600">Questions Asked</div>
            </CardContent>
          </Card>
          
          <Card className="bg-green-50">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-green-600">{stats.topicsCovered}</div>
              <div className="text-sm text-gray-600">Topics Covered</div>
            </CardContent>
          </Card>
          
          <Card className="bg-purple-50">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-purple-600">
                {formatStudyTime(stats.studyTimeMinutes)}
              </div>
              <div className="text-sm text-gray-600">Study Time</div>
            </CardContent>
          </Card>
          
          <Card className="bg-orange-50">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-orange-600">{stats.currentStreak}</div>
              <div className="text-sm text-gray-600">Day Streak</div>
            </CardContent>
          </Card>
        </div>

        {/* Recent Topics */}
        <Card>
          <CardContent className="p-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Recent Topics</h3>
            <div className="space-y-2">
              {recentTopics.length > 0 ? (
                recentTopics.map((topic) => {
                  const IconComponent = topic.icon;
                  return (
                    <div
                      key={topic.id}
                      className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg"
                    >
                      <div className={`w-8 h-8 ${topic.color} rounded-full flex items-center justify-center`}>
                        <IconComponent className="text-white" size={16} />
                      </div>
                      <div className="flex-1">
                        <div className="font-medium text-gray-900">{topic.title}</div>
                        <div className="text-sm text-gray-500">
                          {topic.questionsCount} questions asked
                        </div>
                      </div>
                      <div className="text-xs text-gray-400">{topic.timeAgo}</div>
                    </div>
                  );
                })
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <p>No learning activity yet</p>
                  <p className="text-sm">Start asking questions to see your progress!</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Study Goals */}
        <Card>
          <CardContent className="p-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Today's Goals</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-700">Ask 5 questions</span>
                <div className="flex items-center gap-2">
                  <div className="w-24 h-2 bg-gray-200 rounded-full">
                    <div 
                      className="h-full bg-blue-600 rounded-full transition-all"
                      style={{ width: `${Math.min((stats.questionsAsked % 5) * 20, 100)}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-500">{stats.questionsAsked % 5}/5</span>
                </div>
              </div>
              
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-700">Study for 30 minutes</span>
                <div className="flex items-center gap-2">
                  <div className="w-24 h-2 bg-gray-200 rounded-full">
                    <div 
                      className="h-full bg-green-600 rounded-full transition-all"
                      style={{ width: `${Math.min((stats.studyTimeMinutes % 30) * 100 / 30, 100)}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-500">
                    {Math.min(stats.studyTimeMinutes % 30, 30)}/30m
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
