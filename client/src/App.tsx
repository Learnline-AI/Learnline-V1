import { useState, useEffect } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { queryClient } from './lib/queryClient';
import ChatPage from '@/pages/chat-conversational';
import VADChatPage from '@/pages/chat-vad-conversational';
import SileroVADChatPage from '@/pages/chat-with-silero-vad';
import SettingsPage from '@/pages/settings';
import ProfilePage from '@/pages/profile';
import VADTestPage from '@/pages/vad-test';
import { BottomNavigation } from '@/components/BottomNavigation';
type ActiveTab = 'chat' | 'chat-classic' | 'chat-silero' | 'profile' | 'settings' | 'vad-test';

function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('chat-silero');

  // Handle hash-based navigation for VAD test page
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.slice(1) as ActiveTab;
      if (['chat', 'chat-classic', 'chat-silero', 'profile', 'settings', 'vad-test'].includes(hash)) {
        setActiveTab(hash);
      }
    };

    // Set initial tab from hash
    handleHashChange();
    
    // Listen for hash changes
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const renderCurrentPage = () => {
    switch (activeTab) {
      case 'chat':
        return (
          <VADChatPage
            onShowSettings={() => setActiveTab('settings')}
            onShowProfile={() => setActiveTab('profile')}
          />
        );
      case 'chat-classic':
        return (
          <ChatPage
            onShowSettings={() => setActiveTab('settings')}
            onShowProfile={() => setActiveTab('profile')}
          />
        );
      case 'chat-silero':
        return (
          <SileroVADChatPage
            onShowSettings={() => setActiveTab('settings')}
            onShowProfile={() => setActiveTab('profile')}
          />
        );
      case 'settings':
        return <SettingsPage onBack={() => setActiveTab('chat-silero')} />;
      case 'profile':
        return <ProfilePage onBack={() => setActiveTab('chat-silero')} />;
      case 'vad-test':
        return <VADTestPage />;
      default:
        return (
          <SileroVADChatPage
            onShowSettings={() => setActiveTab('settings')}
            onShowProfile={() => setActiveTab('profile')}
          />
        );
    }
  };

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <div className="min-h-screen w-full flex items-center justify-center bg-gray-50">
          {/* Mobile App Container */}
          <div className="max-w-md w-full bg-white min-h-screen shadow-xl relative overflow-hidden">
            {renderCurrentPage()}
            

            
            {/* Bottom Navigation */}
            <BottomNavigation
              activeTab={activeTab}
              onTabChange={setActiveTab}
            />
          </div>
        </div>
        
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
