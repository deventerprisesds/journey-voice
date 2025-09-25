import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { RealtimeVoiceAssistant } from '@/utils/RealtimeVoiceAssistant';
import { Mic, MicOff, Volume2 } from 'lucide-react';

interface VoiceInterfaceProps {
  onTaskUpdate?: () => void;
}

const VoiceInterface: React.FC<VoiceInterfaceProps> = ({ onTaskUpdate }) => {
  const { toast } = useToast();
  const [isConnected, setIsConnected] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<string>('');
  const [messages, setMessages] = useState<any[]>([]);
  const assistantRef = useRef<RealtimeVoiceAssistant | null>(null);

  const handleMessage = (message: any) => {
    console.log('Voice message:', message);
    setMessages(prev => [...prev, message]);

    // Client-side status events emitted by RealtimeVoiceAssistant
    if (message.type === 'client.processing') {
      setIsProcessing(true);
      setProcessingStatus(message.status || 'Processing...');
      return;
    }
    if (message.type === 'client.done') {
      setIsProcessing(true);
      setProcessingStatus(message.status || 'Done');
      setTimeout(() => {
        setIsProcessing(false);
        setProcessingStatus('');
      }, 1200);
      return;
    }
    if (message.type === 'client.error') {
      setIsProcessing(false);
      setProcessingStatus('');
      toast({
        title: 'Assistant Error',
        description: message.message || 'Something went wrong',
        variant: 'destructive',
      });
      return;
    }

    // Handle processing status updates from function calls
    if (message.type === 'response.function_call_arguments.delta' || 
        message.type === 'response.function_call_arguments.done') {
      if (message.name === 'get_tasks') {
        if (message.type === 'response.function_call_arguments.delta') {
          setIsProcessing(true);
          setProcessingStatus('Analyzing your request...');
        } else if (message.type === 'response.function_call_arguments.done') {
          setProcessingStatus('Generating answer...');
          setTimeout(() => {
            setIsProcessing(false);
            setProcessingStatus('');
            onTaskUpdate?.();
          }, 1500);
        }
      }
    }

    // Show processing for hybrid routing (heuristic)
    if (message.type === 'conversation.item.create' && message.item?.role === 'user') {
      const userText = message.item.content?.[0]?.text?.toLowerCase() || '';
      if (userText.includes('task') || userText.includes('todo') || userText.includes('week') || userText.includes('latest')) {
        setIsProcessing(true);
        setProcessingStatus('Processing query...');
        setTimeout(() => {
          setIsProcessing(false);
          setProcessingStatus('');
        }, 3000);
      }
    }

    // Trigger task refresh when function calls are completed
    if (message.type === 'response.function_call_arguments.done') {
      onTaskUpdate?.();
    }
  };

  const handleConnectionChange = (connected: boolean) => {
    setIsConnected(connected);
    if (!connected) {
      setIsListening(false);
      setIsSpeaking(false);
    }
  };

  const handleListeningChange = (listening: boolean) => {
    setIsListening(listening);
  };

  const handleSpeakingChange = (speaking: boolean) => {
    setIsSpeaking(speaking);
  };

  const connectToAssistant = async () => {
    try {
      assistantRef.current = new RealtimeVoiceAssistant(
        handleMessage,
        handleConnectionChange,
        handleListeningChange,
        handleSpeakingChange
      );
      
      await assistantRef.current.connect();
      
      toast({
        title: "Voice Assistant Connected",
        description: "Start speaking to manage your tasks",
      });
    } catch (error) {
      console.error('Error connecting to voice assistant:', error);
      toast({
        title: "Connection Error",
        description: error instanceof Error ? error.message : 'Failed to connect to voice assistant',
        variant: "destructive",
      });
    }
  };

  const toggleListening = async () => {
    if (!assistantRef.current || !isConnected) return;
    
    try {
      if (isListening) {
        assistantRef.current.stopListening();
      } else {
        await assistantRef.current.startListening();
      }
    } catch (error) {
      console.error('Error toggling listening:', error);
      toast({
        title: "Microphone Error",
        description: "Failed to access microphone. Please check permissions.",
        variant: "destructive",
      });
    }
  };

  const disconnectAssistant = () => {
    assistantRef.current?.disconnect();
    assistantRef.current = null;
  };

  useEffect(() => {
    return () => {
      assistantRef.current?.disconnect();
    };
  }, []);

  return (
    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50">
      <div className="flex flex-col items-center gap-4">
        {/* Status indicator */}
        <div className="text-center">
          {isProcessing && (
            <div className="flex items-center gap-2 px-4 py-2 bg-focus/10 rounded-full shadow-lg border animate-fade-up">
              <div className="w-4 h-4 border-2 border-focus border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-focus font-medium">{processingStatus}</span>
            </div>
          )}
          
          {isSpeaking && !isProcessing && (
            <div className="flex items-center gap-2 px-4 py-2 bg-card rounded-full shadow-lg border animate-fade-up">
              <Volume2 className="w-4 h-4 text-primary" />
              <span className="text-sm text-muted-foreground">Assistant is speaking...</span>
              <div className="flex gap-1">
                {[...Array(3)].map((_, i) => (
                  <div
                    key={i}
                    className="w-1 h-4 bg-primary rounded-full animate-wave"
                    style={{ animationDelay: `${i * 0.2}s` }}
                  />
                ))}
              </div>
            </div>
          )}
          
          {isListening && !isSpeaking && !isProcessing && (
            <div className="flex items-center gap-2 px-4 py-2 bg-primary/10 rounded-full shadow-lg border animate-fade-up">
              <Mic className="w-4 h-4 text-primary animate-pulse" />
              <span className="text-sm text-primary font-medium">Listening...</span>
            </div>
          )}
        </div>

        {/* Main control buttons */}
        <div className="flex items-center gap-4">
          {!isConnected ? (
            <Button 
              onClick={connectToAssistant}
              size="lg"
              className="bg-gradient-to-r from-focus to-focus-light hover:from-focus-dark hover:to-focus text-white rounded-full px-8 py-4 shadow-lg hover:shadow-xl transition-all duration-300"
            >
              <Mic className="w-5 h-5 mr-2" />
              Start Voice Assistant
            </Button>
          ) : (
            <div className="flex items-center gap-3">
              <Button
                onClick={toggleListening}
                size="lg"
                variant={isListening ? "destructive" : "default"}
                className={`rounded-full p-4 shadow-lg transition-all duration-300 ${
                  isListening 
                    ? 'bg-destructive hover:bg-destructive/90 animate-pulse-voice' 
                    : 'bg-gradient-to-r from-focus to-focus-light hover:from-focus-dark hover:to-focus text-white'
                }`}
              >
                {isListening ? (
                  <MicOff className="w-6 h-6" />
                ) : (
                  <Mic className="w-6 h-6" />
                )}
              </Button>
              
              <Button
                onClick={disconnectAssistant}
                variant="outline"
                size="sm"
                className="border-border/50"
              >
                Disconnect
              </Button>
            </div>
          )}
        </div>
        
        {/* Connection status */}
        {isConnected && (
          <div className="text-xs text-muted-foreground text-center animate-fade-up">
            Voice assistant ready • Tap microphone to talk
          </div>
        )}
      </div>
    </div>
  );
};

export default VoiceInterface;