import { Button } from '@/components/ui/button';
import { MessageCircle, User, Settings, Activity, Mic } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BottomNavigationProps {
  activeTab: 'chat' | 'chat-classic' | 'chat-silero' | 'profile' | 'settings' | 'vad-test';
  onTabChange: (tab: 'chat' | 'chat-classic' | 'chat-silero' | 'profile' | 'settings' | 'vad-test') => void;
}

export function BottomNavigation({ activeTab, onTabChange }: BottomNavigationProps) {
  const tabs = [
    { id: 'chat' as const, icon: MessageCircle, label: 'Chat' },
    { id: 'chat-silero' as const, icon: Mic, label: 'Silero VAD' },
    { id: 'vad-test' as const, icon: Activity, label: 'VAD Test' },
    { id: 'profile' as const, icon: User, label: 'Profile' },
    { id: 'settings' as const, icon: Settings, label: 'Settings' },
  ];

  return (
    <nav className="fixed bottom-0 left-1/2 transform -translate-x-1/2 w-full max-w-md bg-white border-t border-gray-200">
      <div className="flex items-center justify-around py-2">
        {tabs.map(({ id, icon: Icon, label }) => (
          <Button
            key={id}
            variant="ghost"
            className={cn(
              "flex flex-col items-center gap-1 p-2 h-auto",
              activeTab === id 
                ? "text-blue-600" 
                : "text-gray-400 hover:text-gray-600"
            )}
            onClick={() => onTabChange(id)}
          >
            <Icon size={20} />
            <span className="text-xs font-medium">{label}</span>
          </Button>
        ))}
      </div>
    </nav>
  );
}
