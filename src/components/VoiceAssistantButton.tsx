import React from 'react';
import { Button } from '@/components/ui/button';
import { Mic, MicOff } from 'lucide-react';
import { useVoiceAssistant } from '@/contexts/VoiceAssistantContext';

const VoiceAssistantButton: React.FC = () => {
  const [isClickDisabled, setIsClickDisabled] = React.useState(false);
  
  try {
    const {
      isConnected,
      isListening,
      isSpeechDetected,
      isProcessing,
      connectToAssistant,
      disconnectAssistant,
      toggleListening,
    } = useVoiceAssistant();

    const handleClick = async () => {
      // Prevent duplicate clicks
      if (isClickDisabled) return;
      
      setIsClickDisabled(true);
      
      try {
        if (!isConnected) {
          // Not connected → Connect
          await connectToAssistant();
        } else if (isListening) {
          // Connected and listening → Stop listening (keep connection)
          await toggleListening();
        } else {
          // Connected but not listening → Disconnect
          disconnectAssistant();
        }
      } finally {
        // Re-enable after a short delay
        setTimeout(() => setIsClickDisabled(false), 1000);
      }
    };

    const getButtonState = () => {
      // 🔵 Blue - Disconnected
      if (!isConnected) {
        return {
          className: "bg-blue-500 hover:bg-blue-600 text-white shadow-lg transition-all duration-300",
          icon: <Mic className="w-6 h-6" />,
        };
      }
      
      // 🟢 Green - Actively detecting speech
      if (isListening && isSpeechDetected) {
        return {
          className: "bg-green-500 hover:bg-green-600 text-white animate-pulse shadow-lg transition-all duration-300",
          icon: <Mic className="w-6 h-6" />,
        };
      }
      
      // ⚪ White with blue outline - Listening but no speech
      if (isListening && !isSpeechDetected) {
        return {
          className: "bg-white border-2 border-blue-500 text-blue-500 shadow-lg ring-2 ring-blue-300 ring-offset-2 transition-all duration-300",
          icon: <Mic className="w-6 h-6" />,
        };
      }
      
      // ⚪ White with blue outline - Connected but not listening
      if (isConnected && !isListening) {
        return {
          className: "bg-white border-2 border-blue-500 text-blue-500 hover:bg-blue-50 shadow-lg transition-all duration-300",
          icon: <Mic className="w-6 h-6" />,
        };
      }
      
      // Processing state
      if (isProcessing) {
        return {
          className: "bg-blue-500 text-white shadow-lg transition-all duration-300",
          icon: <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />,
        };
      }

      return {
        className: "bg-blue-500 hover:bg-blue-600 text-white shadow-lg transition-all duration-300",
        icon: <Mic className="w-6 h-6" />,
      };
    };

    const buttonState = getButtonState();

    return (
      <Button
        onClick={handleClick}
        size="lg"
        className={`rounded-full ${buttonState.className}`}
        disabled={isProcessing || isClickDisabled}
      >
        {buttonState.icon}
      </Button>
    );
  } catch (error) {
    console.error('VoiceAssistantButton error:', error);
    return (
      <Button
        size="lg"
        className="rounded-full bg-blue-500 hover:bg-blue-600 text-white shadow-lg transition-all duration-300"
        onClick={() => console.log('Voice assistant context error')}
      >
        <Mic className="w-6 h-6" />
      </Button>
    );
  }
};

export default VoiceAssistantButton;