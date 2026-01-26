import React, { createContext, useContext, useState, useRef, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { RealtimeVoiceAssistant } from '@/utils/RealtimeVoiceAssistant';
import { loadUserSchedulingConfig } from '@/services/schedulingService';
import { useAuth } from '@/hooks/useAuth';

interface VoiceAssistantContextType {
  // Connection state
  isConnected: boolean;
  isListening: boolean;
  isSpeaking: boolean;
  isSpeechDetected: boolean;
  isProcessing: boolean;
  processingStatus: string;
  connectionError: { type?: string; message: string } | null;
  retryAttempts: number;
  
  // Actions
  connectToAssistant: () => Promise<void>;
  disconnectAssistant: () => void;
  toggleListening: () => Promise<void>;
  testConnection: () => Promise<void>;
  
  // Callbacks
  onTaskUpdate?: () => void;
}

const VoiceAssistantContext = createContext<VoiceAssistantContextType | null>(null);

export const useVoiceAssistant = () => {
  const context = useContext(VoiceAssistantContext);
  if (!context) {
    throw new Error('useVoiceAssistant must be used within VoiceAssistantProvider');
  }
  return context;
};

interface VoiceAssistantProviderProps {
  children: React.ReactNode;
  onTaskUpdate?: () => void;
}

export const VoiceAssistantProvider: React.FC<VoiceAssistantProviderProps> = ({ 
  children, 
  onTaskUpdate 
}) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [isConnected, setIsConnected] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isSpeechDetected, setIsSpeechDetected] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<string>('');
  const [messages, setMessages] = useState<any[]>([]);
  const [connectionError, setConnectionError] = useState<{ type?: string; message: string } | null>(null);
  const [retryAttempts, setRetryAttempts] = useState(0);
  const [autoGreetingTimeout, setAutoGreetingTimeout] = useState(5000); // Default 5 seconds
  const assistantRef = useRef<RealtimeVoiceAssistant | null>(null);
  const autoGreetingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Load auto-greeting timeout from user settings
  useEffect(() => {
    if (user?.id) {
      loadUserSchedulingConfig(user.id).then(config => {
        const timeout = (config.auto_greeting_timeout || 5) * 1000; // Convert to milliseconds
        setAutoGreetingTimeout(timeout);
      });
    }
  }, [user?.id]);

  const handleMessage = (message: any) => {
    console.log('Voice message:', message);
    setMessages(prev => [...prev, message]);

    // Handle speech detection events
    if (message.type === 'speech.detected') {
      setIsSpeechDetected(message.detected);
      
      // Clear auto-greeting timeout when speech is detected
      if (message.detected && autoGreetingTimeoutRef.current) {
        clearTimeout(autoGreetingTimeoutRef.current);
        autoGreetingTimeoutRef.current = null;
      }
      
      return;
    }

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
      // Emit event for calendar refresh
      window.dispatchEvent(new CustomEvent('voice-task-created'));
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
    if (message.type === 'assistant.disconnect') {
      toast({
        title: "Voice Assistant",
        description: message.message || "Disconnecting...",
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
    if (connected) {
      setConnectionError(null);
      setRetryAttempts(0);
    } else {
      setIsListening(false);
      setIsSpeaking(false);
    }
  };

  const handleListeningChange = (listening: boolean) => {
    setIsListening(listening);
    
    // Clear any existing auto-greeting timeout
    if (autoGreetingTimeoutRef.current) {
      clearTimeout(autoGreetingTimeoutRef.current);
      autoGreetingTimeoutRef.current = null;
    }
    
    // Start auto-greeting timeout when listening starts
    if (listening && !isSpeechDetected) {
      autoGreetingTimeoutRef.current = setTimeout(() => {
        if (assistantRef.current && isConnected && isListening && !isSpeechDetected) {
          console.log('Auto-greeting: No speech detected, sending greeting prompt');
          assistantRef.current.sendTextMessage("Hello! I'm here to help. What can I do for you today?");
        }
      }, autoGreetingTimeout); // Use the configurable timeout
    }
  };

  const handleSpeakingChange = (speaking: boolean) => {
    setIsSpeaking(speaking);
  };

  const connectToAssistant = async () => {
    // Guard against duplicate connections
    if (isConnected || assistantRef.current) {
      console.log('Voice assistant already connected or connecting, skipping');
      return;
    }
    
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
      
      // Handle different error types with specific guidance
      const errorType = (error as any)?.type;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // Set connection error state for status component
      setConnectionError({
        type: errorType,
        message: errorMessage
      });
      
      let title = "Connection Error";
      let description = errorMessage;
      
      switch (errorType) {
        case 'quota_exceeded':
          title = "OpenAI Quota Exceeded";
          description = "Your OpenAI API quota has been exceeded. Check your billing settings at platform.openai.com and ensure you have sufficient credits.";
          break;
        case 'invalid_key':
          title = "Invalid API Key";
          description = "Your OpenAI API key is invalid or has been revoked. Please update your API key in the project settings.";
          break;
        case 'rate_limit':
          title = "Rate Limit Exceeded";
          description = "Too many requests to OpenAI. Please wait a moment and try again.";
          setRetryAttempts(prev => prev + 1);
          break;
        case 'webrtc_error':
          title = "Connection Failed";
          description = `Failed to establish voice connection: ${errorMessage}`;
          break;
        case 'model_error':
          title = "Model Unavailable";
          description = "The voice model is currently unavailable. Please contact support if this persists.";
          break;
        default:
          title = "Connection Error";
          description = `Failed to connect: ${errorMessage}`;
      }

      toast({
        title,
        description,
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
    setConnectionError(null);
  };

  const testConnection = async () => {
    if (assistantRef.current && isConnected) {
      try {
        await assistantRef.current.sendTextMessage("Test connection");
        toast({
          title: "Connection Test",
          description: "Voice assistant is responding normally",
        });
      } catch (error) {
        toast({
          title: "Connection Test Failed",
          description: error instanceof Error ? error.message : 'Test failed',
          variant: "destructive",
        });
      }
    }
  };

  useEffect(() => {
    return () => {
      if (autoGreetingTimeoutRef.current) {
        clearTimeout(autoGreetingTimeoutRef.current);
      }
      assistantRef.current?.disconnect();
    };
  }, []);

  return (
    <VoiceAssistantContext.Provider
      value={{
        isConnected,
        isListening,
        isSpeaking,
        isSpeechDetected,
        isProcessing,
        processingStatus,
        connectionError,
        retryAttempts,
        connectToAssistant,
        disconnectAssistant,
        toggleListening,
        testConnection,
        onTaskUpdate,
      }}
    >
      {children}
    </VoiceAssistantContext.Provider>
  );
};