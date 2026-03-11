import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { 
  Settings as SettingsIcon, 
  Bell, 
  User, 
  Palette, 
  Shield,
  Wrench,
  FileSpreadsheet,
  Sparkles,
  Home,
  ListChecks
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useIsMobile } from '@/hooks/use-mobile';
import MobilePageHeader from '@/components/MobilePageHeader';
import NotificationSettings from '@/components/NotificationSettings';
import CronJobTesting from '@/components/CronJobTesting';
import UpcomingReminders from '@/components/UpcomingReminders';
import NotificationStatusDashboard from '@/components/NotificationStatusDashboard';
import SchedulingSettings from '@/components/SchedulingSettings';
import VoiceAssistantSettings from '@/components/VoiceAssistantSettings';
import ProfileSettings from '@/components/ProfileSettings';
import { AssignmentSyncSettings } from '@/components/AssignmentSyncSettings';
import { useOAuthCallback } from '@/hooks/useOAuthCallback';

const tabConfig = [
  { value: 'notifications', label: 'Notifications', icon: Bell },
  { value: 'scheduling', label: 'Scheduling', icon: SettingsIcon },
  { value: 'ai', label: 'AI Instructions', icon: Sparkles },
  { value: 'assignments', label: 'Assignments', icon: FileSpreadsheet },
  { value: 'testing', label: 'Testing', icon: Wrench },
  { value: 'profile', label: 'Profile', icon: User },
  { value: 'appearance', label: 'Appearance', icon: Palette },
  { value: 'privacy', label: 'Privacy', icon: Shield },
];

const Settings: React.FC = () => {
  // Handle OAuth callback from Google/Outlook
  useOAuthCallback();
  
  const { user } = useAuth();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [currentTab, setCurrentTab] = useState('notifications');

  // Redirect to auth if not logged in
  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center">
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-bold">Please Sign In</h1>
          <p className="text-muted-foreground">You need to be logged in to access settings.</p>
          <Link to="/auth">
            <Button>Go to Sign In</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Mobile-responsive header */}
      <MobilePageHeader
        title="Settings"
        backTo="/"
        actions={
          !isMobile ? (
            <Button
              onClick={() => navigate('/')}
              className="flex items-center gap-2"
            >
              <Home className="h-4 w-4" />
              Done
            </Button>
          ) : null
        }
      />

      <div className="container mx-auto px-4 py-6 max-w-4xl">
        <Tabs value={currentTab} onValueChange={setCurrentTab} className="w-full">
          {/* Mobile: Use Select dropdown for tabs */}
          {isMobile ? (
            <Select value={currentTab} onValueChange={setCurrentTab}>
              <SelectTrigger className="w-full mb-4">
                <SelectValue>
                  {(() => {
                    const tab = tabConfig.find(t => t.value === currentTab);
                    if (!tab) return 'Select setting';
                    const Icon = tab.icon;
                    return (
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4" />
                        {tab.label}
                      </div>
                    );
                  })()}
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="bg-popover">
                {tabConfig.map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <SelectItem key={tab.value} value={tab.value}>
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4" />
                        {tab.label}
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          ) : (
            /* Desktop: Scrollable tabs */
            <TabsList className="flex w-full overflow-x-auto gap-1 h-auto flex-wrap">
              {tabConfig.map((tab) => {
                const Icon = tab.icon;
                return (
                  <TabsTrigger 
                    key={tab.value} 
                    value={tab.value} 
                    className="flex items-center gap-2 whitespace-nowrap"
                  >
                    <Icon className="h-4 w-4" />
                    <span className="hidden lg:inline">{tab.label}</span>
                    <span className="lg:hidden">{tab.label.split(' ')[0]}</span>
                  </TabsTrigger>
                );
              })}
            </TabsList>
          )}

          <TabsContent value="notifications" className="mt-6">
            <div className="space-y-6">
              <NotificationSettings />
              <UpcomingReminders />
              <NotificationStatusDashboard />
            </div>
          </TabsContent>

          <TabsContent value="scheduling" className="mt-6">
            <SchedulingSettings />
          </TabsContent>

          <TabsContent value="ai" className="mt-6">
            <VoiceAssistantSettings />
          </TabsContent>

          <TabsContent value="assignments" className="mt-6">
            <AssignmentSyncSettings />
          </TabsContent>

          <TabsContent value="testing" className="mt-6">
            <CronJobTesting />
          </TabsContent>

          <TabsContent value="profile" className="mt-6">
            <ProfileSettings />
          </TabsContent>

          <TabsContent value="appearance" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle>Appearance Settings</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">
                  Theme and appearance customization will be implemented in a future update.
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="privacy" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle>Privacy & Security</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">
                  Privacy and security settings will be implemented in a future update.
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default Settings;