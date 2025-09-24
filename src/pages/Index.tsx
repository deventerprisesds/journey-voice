import React, { useState } from 'react';
import VoiceInterface from '@/components/VoiceInterface';
import ItineraryList from '@/components/ItineraryList';
import { Plane, Sparkles } from 'lucide-react';
import travelHero from '@/assets/travel-hero.jpg';

const Index = () => {
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const handleItineraryUpdate = () => {
    setRefreshTrigger(prev => prev + 1);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky via-background to-accent/20">
      {/* Hero Section */}
      <section className="relative overflow-hidden">
        <div 
          className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-20"
          style={{ backgroundImage: `url(${travelHero})` }}
        />
        <div className="absolute inset-0 bg-gradient-to-br from-ocean/10 via-transparent to-sunset/5" />
        
        <div className="relative z-10 container mx-auto px-6 pt-20 pb-32">
          <div className="text-center max-w-4xl mx-auto">
            <div className="flex items-center justify-center gap-3 mb-6">
              <div className="p-3 rounded-full bg-gradient-to-r from-ocean to-ocean-light text-white shadow-lg">
                <Plane className="w-8 h-8" />
              </div>
              <Sparkles className="w-6 h-6 text-sunset animate-pulse" />
            </div>
            
            <h1 className="text-6xl md:text-7xl font-bold mb-6 leading-tight">
              <span className="bg-gradient-to-r from-ocean via-ocean-light to-sunset bg-clip-text text-transparent">
                Voice-Powered
              </span>
              <br />
              <span className="text-foreground">Travel Planning</span>
            </h1>
            
            <p className="text-xl md:text-2xl text-muted-foreground mb-8 leading-relaxed max-w-3xl mx-auto">
              Manage your itinerary effortlessly with AI-powered voice commands. 
              Just speak naturally to add activities, restaurants, and accommodations to your trip.
            </p>
            
            <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-ocean animate-pulse" />
                <span>Real-time voice interaction</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-sunset animate-pulse" />
                <span>Smart itinerary management</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-mountain animate-pulse" />
                <span>Travel recommendations</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Main Content */}
      <main className="relative z-10 -mt-16">
        <ItineraryList refreshTrigger={refreshTrigger} />
      </main>

      {/* Voice Interface */}
      <VoiceInterface onItineraryUpdate={handleItineraryUpdate} />

      {/* Background Elements */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-20 left-10 w-72 h-72 rounded-full bg-gradient-to-r from-ocean/5 to-ocean-light/10 blur-3xl animate-pulse" />
        <div className="absolute bottom-20 right-10 w-96 h-96 rounded-full bg-gradient-to-r from-sunset/5 to-accent/10 blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full bg-gradient-to-r from-sky/3 to-ocean/5 blur-3xl animate-pulse" style={{ animationDelay: '2s' }} />
      </div>
    </div>
  );
};

export default Index;
