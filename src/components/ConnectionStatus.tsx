import React from 'react';
import { AlertCircle, CheckCircle, Clock, WifiOff } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

interface ConnectionStatusProps {
  status: 'connected' | 'connecting' | 'disconnected' | 'error';
  error?: {
    type?: string;
    message: string;
  };
  onRetry?: () => void;
  onTestConnection?: () => void;
}

const ConnectionStatus: React.FC<ConnectionStatusProps> = ({ 
  status, 
  error, 
  onRetry, 
  onTestConnection 
}) => {
  if (status === 'connected') {
    return (
      <Alert className="border-green-200 bg-green-50 text-green-800">
        <CheckCircle className="h-4 w-4" />
        <AlertDescription className="flex items-center justify-between">
          <span>Voice assistant is connected and ready</span>
          {onTestConnection && (
            <Button 
              size="sm" 
              variant="outline" 
              onClick={onTestConnection}
              className="border-green-300 text-green-700 hover:bg-green-100"
            >
              Test Connection
            </Button>
          )}
        </AlertDescription>
      </Alert>
    );
  }

  if (status === 'connecting') {
    return (
      <Alert className="border-blue-200 bg-blue-50 text-blue-800">
        <Clock className="h-4 w-4 animate-spin" />
        <AlertDescription>
          Connecting to voice assistant...
        </AlertDescription>
      </Alert>
    );
  }

  if (status === 'error' && error) {
    const getErrorIcon = () => {
      switch (error.type) {
        case 'quota_exceeded':
          return <AlertCircle className="h-4 w-4" />;
        case 'invalid_key':
          return <AlertCircle className="h-4 w-4" />;
        case 'rate_limit':
          return <Clock className="h-4 w-4" />;
        default:
          return <WifiOff className="h-4 w-4" />;
      }
    };

    const getActionButton = () => {
      switch (error.type) {
        case 'quota_exceeded':
          return (
            <Button 
              size="sm" 
              variant="outline"
              onClick={() => window.open('https://platform.openai.com/usage', '_blank')}
              className="border-red-300 text-red-700 hover:bg-red-100"
            >
              Check Billing
            </Button>
          );
        case 'rate_limit':
          return onRetry ? (
            <Button 
              size="sm" 
              variant="outline" 
              onClick={onRetry}
              className="border-orange-300 text-orange-700 hover:bg-orange-100"
            >
              Retry in 60s
            </Button>
          ) : null;
        default:
          return onRetry ? (
            <Button 
              size="sm" 
              variant="outline" 
              onClick={onRetry}
              className="border-red-300 text-red-700 hover:bg-red-100"
            >
              Retry
            </Button>
          ) : null;
      }
    };

    return (
      <Alert variant="destructive" className="border-red-200 bg-red-50 text-red-800">
        {getErrorIcon()}
        <AlertDescription className="flex items-center justify-between">
          <span>{error.message}</span>
          {getActionButton()}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert className="border-gray-200 bg-gray-50 text-gray-800">
      <WifiOff className="h-4 w-4" />
      <AlertDescription className="flex items-center justify-between">
        <span>Voice assistant is not connected</span>
        {onRetry && (
          <Button 
            size="sm" 
            variant="outline" 
            onClick={onRetry}
            className="border-gray-300 text-gray-700 hover:bg-gray-100"
          >
            Connect
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
};

export default ConnectionStatus;