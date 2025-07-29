import { Button } from '@/components/ui/button';
import { Play, User, Bot } from 'lucide-react';
import { ChatMessage } from '@/types';
import { cn } from '@/lib/utils';

interface ChatBubbleProps {
  message: ChatMessage;
  onPlayAudio?: (audioUrl: string) => void;
  isPlaying?: boolean;
}

export function ChatBubble({ message, onPlayAudio, isPlaying }: ChatBubbleProps) {
  const isStudent = message.type === 'student';
  const isAI = message.type === 'ai';

  return (
    <div className={cn(
      "flex items-start gap-3 animate-in fade-in duration-200",
      isStudent ? "justify-end" : ""
    )}>
      {/* Avatar - only show for AI messages on left */}
      {isAI && (
        <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center flex-shrink-0">
          <Bot className="text-white" size={16} />
        </div>
      )}

      {/* Message Bubble */}
      <div className={cn(
        "rounded-2xl px-4 py-3 max-w-xs",
        isStudent 
          ? "bg-blue-600 text-white rounded-tr-md" 
          : "bg-gray-100 text-gray-800 rounded-tl-md"
      )}>
        <p className="text-sm">{message.content}</p>
        
        {/* Audio Status Indicator for AI messages */}
        {isAI && (
          <div className="flex items-center gap-2 mt-2">
            {isPlaying && (
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                <span className="text-xs text-gray-500">Speaking...</span>
              </div>
            )}
            {message.duration && (
              <span className="text-xs text-gray-500">
                {message.duration}
              </span>
            )}
          </div>
        )}
        
        {/* Student message controls */}
        {isStudent && message.duration && (
          <div className="flex items-center gap-2 mt-2 justify-end">
            <span className="text-xs text-blue-200">
              {message.duration}
            </span>
            <div className="w-3 h-3">
              <svg viewBox="0 0 12 12" className="w-3 h-3 text-blue-200">
                <path fill="currentColor" d="M6 0a6 6 0 1 0 6 6A6 6 0 0 0 6 0zM4 4h4v1H4V4zm0 2h4v1H4V6z"/>
              </svg>
            </div>
          </div>
        )}
      </div>

      {/* Avatar - only show for student messages on right */}
      {isStudent && (
        <div className="w-8 h-8 bg-gray-300 rounded-full flex items-center justify-center flex-shrink-0">
          <User className="text-white" size={16} />
        </div>
      )}
    </div>
  );
}

export function TypingIndicator() {
  return (
    <div className="flex items-start gap-3 animate-in fade-in duration-200">
      <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center flex-shrink-0">
        <Bot className="text-white" size={16} />
      </div>
      <div className="bg-gray-100 rounded-2xl rounded-tl-md px-4 py-3">
        <div className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="w-2 h-2 bg-gray-400 rounded-full animate-pulse"
              style={{ animationDelay: `${i * 0.2}s` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
