import React from 'react';
import { Button } from '@/components/ui/button';
import { Mic, MicOff } from 'lucide-react';
import { useVoiceAssistant } from '@/contexts/VoiceAssistantContext';

const VoiceAssistantButton: React.FC = () => {
  try {
    const {
      isConnected,
      isListening,
      isProcessing,
      connectToAssistant,
      toggleListening,
    } = useVoiceAssistant();

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
          className: "bg-gradient-to-r from-focus to-focus-light hover:from-focus-dark hover:to-focus text-white shadow-lg hover:shadow-xl",
          icon: <Mic className="w-5 h-5" />,
        };
      } else if (isListening) {
        return {
          className: "bg-destructive hover:bg-destructive/90 text-white animate-pulse-voice shadow-lg hover:shadow-xl",
          icon: <MicOff className="w-5 h-5" />,
        };
      } else if (isProcessing) {
        return {
          className: "bg-gradient-to-r from-focus to-focus-light hover:from-focus-dark hover:to-focus text-white shadow-lg hover:shadow-xl",
          icon: <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />,
        };
      } else {
        return {
          className: "bg-gradient-to-r from-focus to-focus-light hover:from-focus-dark hover:to-focus text-white shadow-lg hover:shadow-xl",
          icon: <Mic className="w-5 h-5" />,
        };
      }
    };

    const buttonState = getButtonState();

    return (
      <Button
        onClick={handleClick}
        size="lg"
        className={`rounded-full transition-all duration-300 ${buttonState.className}`}
        disabled={isProcessing}
      >
        {buttonState.icon}
      </Button>
    );
  } catch (error) {
    console.error('VoiceAssistantButton error:', error);
    return (
      <Button
        size="lg"
        className="rounded-full bg-gradient-to-r from-muted to-muted hover:from-muted/80 hover:to-muted/80 text-muted-foreground shadow-lg hover:shadow-xl transition-all duration-300"
        onClick={() => console.log('Voice assistant context error')}
      >
        <Mic className="w-5 h-5" />
      </Button>
    );
  }
};

export default VoiceAssistantButton;