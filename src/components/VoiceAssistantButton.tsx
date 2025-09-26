import React from 'react';
import { Button } from '@/components/ui/button';
import { Mic, MicOff } from 'lucide-react';
import { useVoiceAssistant } from '@/contexts/VoiceAssistantContext';

const VoiceAssistantButton: React.FC = () => {
  console.log('VoiceAssistantButton rendering'); // Debug log
  
  try {
    const {
      isConnected,
      isListening,
      isProcessing,
      connectToAssistant,
      toggleListening,
    } = useVoiceAssistant();

    console.log('Voice Assistant State:', { isConnected, isListening, isProcessing }); // Debug log

    const handleClick = async () => {
      if (!isConnected) {
        await connectToAssistant();
      } else {
        await toggleListening();
      }
    };

    const getButtonState = () => {
      if (!isConnected) {
        return {
          className: "bg-muted hover:bg-muted/80 text-muted-foreground",
          icon: <Mic className="w-5 h-5" />,
        };
      } else if (isListening) {
        return {
          className: "bg-destructive hover:bg-destructive/90 text-white animate-pulse-voice",
          icon: <MicOff className="w-5 h-5" />,
        };
      } else if (isProcessing) {
        return {
          className: "bg-focus hover:bg-focus/90 text-white",
          icon: <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />,
        };
      } else {
        return {
          className: "bg-primary hover:bg-primary/90 text-white shadow-glow",
          icon: <Mic className="w-5 h-5" />,
        };
      }
    };

    const buttonState = getButtonState();

    return (
      <Button
        onClick={handleClick}
        size="icon"
        className={`w-10 h-10 rounded-full transition-all duration-300 ${buttonState.className}`}
        disabled={isProcessing}
      >
        {buttonState.icon}
      </Button>
    );
  } catch (error) {
    console.error('VoiceAssistantButton error:', error);
    return (
      <Button
        size="icon"
        className="w-10 h-10 rounded-full bg-muted hover:bg-muted/80 text-muted-foreground"
        onClick={() => console.log('Voice assistant context error')}
      >
        <Mic className="w-5 h-5" />
      </Button>
    );
  }
};

export default VoiceAssistantButton;