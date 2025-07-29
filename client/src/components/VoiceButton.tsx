import { Button } from '@/components/ui/button';
import { Mic, Square } from 'lucide-react';
import { cn } from '@/lib/utils';

interface VoiceButtonProps {
  isRecording: boolean;
  onStartRecording: () => void;
  onStopRecording: () => void;
  disabled?: boolean;
}

export function VoiceButton({ isRecording, onStartRecording, onStopRecording, disabled }: VoiceButtonProps) {
  return (
    <div className="flex justify-center">
      <div className="relative">
        {/* Pulse Ring Animation */}
        {isRecording && (
          <div className="absolute inset-0 rounded-full bg-cyan-500 opacity-30 animate-ping" />
        )}
        
        {/* Main Voice Button */}
        <Button
          size="lg"
          className={cn(
            "w-16 h-16 rounded-full shadow-lg transition-all duration-200 transform hover:scale-105 active:scale-95 touch-manipulation tap-target",
            isRecording 
              ? "bg-red-500 hover:bg-red-600 active:bg-red-700" 
              : "bg-cyan-500 hover:bg-cyan-600 active:bg-cyan-700"
          )}
          onTouchStart={(e) => {
            e.preventDefault();
            isRecording ? onStopRecording() : onStartRecording();
          }}
          onMouseDown={(e) => {
            e.preventDefault();
            isRecording ? onStopRecording() : onStartRecording();
          }}
          disabled={disabled}
        >
          {isRecording ? (
            <Square className="text-white text-xl" size={24} />
          ) : (
            <Mic className="text-white text-xl" size={24} />
          )}
        </Button>
      </div>
    </div>
  );
}

export function VoiceLevel({ isVisible }: { isVisible: boolean }) {
  if (!isVisible) return null;

  return (
    <div className="flex justify-center mb-4">
      <div className="flex items-end gap-1 h-8">
        {Array.from({ length: 9 }, (_, i) => (
          <div
            key={i}
            className="w-1 bg-cyan-500 rounded-full animate-pulse"
            style={{
              height: `${20 + (i % 5) * 20}%`,
              animationDelay: `${i * 0.1}s`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
