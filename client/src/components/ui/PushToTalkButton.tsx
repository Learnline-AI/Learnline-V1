import { useVoiceRecording } from "@/hooks/useVoiceRecording";
import { Mic } from "lucide-react";
import { cn } from "@/lib/utils";

interface PushToTalkButtonProps {
  onRecordingComplete: (audioBlob: Blob) => void;
  disabled?: boolean;
  onRecordingStart?: () => void;
}

export function PushToTalkButton({
  onRecordingComplete,
  disabled,
  onRecordingStart,
}: PushToTalkButtonProps) {
  const { isRecording, startRecording, stopRecording } = useVoiceRecording({
    onRecordingComplete,
  });

  const handleStart = () => {
    if (!disabled) {
      onRecordingStart?.();
      startRecording();
    }
  };

  const handleStop = () => {
    if (isRecording) {
      stopRecording();
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    handleStart();
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    handleStop();
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    handleStart();
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    e.preventDefault();
    handleStop();
  };

  return (
    <div className="relative">
      <button
        className={cn(
          "w-16 h-16 rounded-full flex items-center justify-center shadow-lg transition-all duration-200 select-none",
          isRecording
            ? "bg-red-500 scale-110 ring-4 ring-red-300 animate-pulse"
            : "bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 active:scale-95",
          disabled && "opacity-50 cursor-not-allowed",
        )}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleStop}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleStop}
        disabled={disabled}
        style={{ touchAction: "none", userSelect: "none" }}
      >
        <Mic className="text-white" size={24} />
      </button>
      {isRecording && (
        <div className="absolute -top-8 left-1/2 transform -translate-x-1/2 bg-black bg-opacity-75 text-white px-2 py-1 rounded text-xs whitespace-nowrap">
          Recording...
        </div>
      )}
    </div>
  );
}
