import React from 'react';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { useCommsConsole } from '@/contexts/CommsConsoleContext';
import {
  Sheet,
  SheetContent,
} from '@/components/ui/sheet';
import AssistantHeader from './AssistantHeader';
import AssistantSidebar from './AssistantSidebar';
import ConversationPane from './ConversationPane';
import TextInputBar from './TextInputBar';
import ModeToggle from './ModeToggle';

interface CommsConsoleProps {
  className?: string;
  embedded?: boolean;
}

const CommsConsole: React.FC<CommsConsoleProps> = ({ className, embedded = false }) => {
  const isMobile = useIsMobile();
  const {
    isPanelOpen,
    isSidebarExpanded,
    togglePanel,
    toggleSidebar,
    currentAssistant,
    assistants,
    selectAssistant,
    currentMode,
    setMode,
    allMessages,
    isLoading,
    voiceState,
    sendMessage,
    isConnected,
    connectVoice,
    disconnectVoice,
    phoneCallState,
    setPhoneCallState,
    isMobileSidebarOpen,
    setMobileSidebarOpen,
  } = useCommsConsole();

  // In embedded mode, always show. Otherwise, respect isPanelOpen
  if (!embedded && !isPanelOpen) {
    return null;
  }

  const orbColor = currentAssistant?.orb_color || '#3B82F6';

  const handleVoiceToggle = () => {
    if (isConnected) {
      disconnectVoice();
    } else {
      connectVoice();
    }
  };

  const handleMobileSidebarToggle = () => {
    if (isMobile) {
      setMobileSidebarOpen(true);
    } else {
      toggleSidebar();
    }
  };

  // Sidebar content component for reuse
  const SidebarContent = (
    <AssistantSidebar
      assistants={assistants}
      currentAssistant={currentAssistant}
      onSelectAssistant={(assistant) => {
        selectAssistant(assistant);
        if (isMobile) {
          setMobileSidebarOpen(false);
        }
      }}
      isExpanded={true}
      onToggleExpanded={() => setMobileSidebarOpen(false)}
    />
  );

  // Embedded mode - full page layout
  if (embedded) {
    return (
      <div className={cn('flex min-h-[100dvh] w-full bg-background', className)} style={{ overscrollBehavior: 'none' }}>
        {/* Desktop sidebar */}
        {!isMobile && (
          <AssistantSidebar
            assistants={assistants}
            currentAssistant={currentAssistant}
            onSelectAssistant={selectAssistant}
            isExpanded={isSidebarExpanded}
            onToggleExpanded={toggleSidebar}
          />
        )}

        {/* Mobile sidebar drawer */}
        {isMobile && (
          <Sheet open={isMobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
            <SheetContent side="left" className="w-72 p-0 pt-12">
              {SidebarContent}
            </SheetContent>
          </Sheet>
        )}

        {/* Main content area */}
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          {/* Header */}
          <AssistantHeader
            currentAssistant={currentAssistant}
            assistants={assistants}
            onSelectAssistant={selectAssistant}
            onToggleSidebar={handleMobileSidebarToggle}
            onClose={togglePanel}
            isSidebarExpanded={isSidebarExpanded}
            showCloseButton={false}
            showSidebarToggle={isMobile}
          />

          {/* Conversation pane */}
          <ConversationPane
            mode={currentMode}
            voiceState={voiceState}
            messages={allMessages}
            orbColor={orbColor}
            isLoading={isLoading}
            isConnected={isConnected}
            onVoiceToggle={handleVoiceToggle}
            phoneCallState={phoneCallState}
            onPhoneCallStateChange={setPhoneCallState}
          />

          {/* Text input */}
          <TextInputBar
            onSend={sendMessage}
            mode={currentMode}
            isLoading={isLoading}
          />

          {/* Mode toggle */}
          <ModeToggle
            currentMode={currentMode}
            onModeChange={setMode}
            className="border-t pb-safe"
          />
        </div>
      </div>
    );
  }

  // Overlay mode (legacy - for other pages)
  return (
    <div
      className={cn(
        'fixed inset-0 z-50 bg-background flex flex-col',
        'md:inset-auto md:right-0 md:top-0 md:bottom-0 md:w-[400px] md:border-l md:shadow-xl',
        className
      )}
    >
      {/* Header */}
      <AssistantHeader
        currentAssistant={currentAssistant}
        assistants={assistants}
        onSelectAssistant={selectAssistant}
        onToggleSidebar={handleMobileSidebarToggle}
        onClose={togglePanel}
        isSidebarExpanded={isSidebarExpanded}
        showCloseButton={isMobile}
        showSidebarToggle={isMobile}
      />

      {/* Mobile sidebar drawer for overlay mode too */}
      {isMobile && (
        <Sheet open={isMobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
          <SheetContent side="left" className="w-72 p-0 pt-12">
            {SidebarContent}
          </SheetContent>
        </Sheet>
      )}

      {/* Main content area with optional sidebar */}
      <div className="flex flex-1 min-h-0">
        {/* Sidebar - hidden on mobile, collapsible on desktop */}
        {!isMobile && (
          <AssistantSidebar
            assistants={assistants}
            currentAssistant={currentAssistant}
            onSelectAssistant={selectAssistant}
            isExpanded={isSidebarExpanded}
            onToggleExpanded={toggleSidebar}
          />
        )}

        {/* Conversation pane */}
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          <ConversationPane
            mode={currentMode}
            voiceState={voiceState}
            messages={allMessages}
            orbColor={orbColor}
            isLoading={isLoading}
            isConnected={isConnected}
            onVoiceToggle={handleVoiceToggle}
            phoneCallState={phoneCallState}
            onPhoneCallStateChange={setPhoneCallState}
          />

          {/* Text input */}
          <TextInputBar
            onSend={sendMessage}
            mode={currentMode}
            isLoading={isLoading}
          />

          {/* Mode toggle */}
          <ModeToggle
            currentMode={currentMode}
            onModeChange={setMode}
            className="border-t pb-safe"
          />
        </div>
      </div>
    </div>
  );
};

export default CommsConsole;