import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MapPin, Clock, Calendar } from 'lucide-react';
import { format } from 'date-fns';

interface ItineraryItem {
  id: string;
  title: string;
  description?: string;
  location?: string;
  start_time?: string;
  end_time?: string;
  category: string;
  notes?: string;
}

interface ItineraryCardProps {
  item: ItineraryItem;
}

const categoryIcons: Record<string, string> = {
  activity: '🎯',
  accommodation: '🏨',
  transport: '✈️',
  food: '🍽️',
  other: '📝'
};

const categoryColors: Record<string, string> = {
  activity: 'bg-ocean/10 text-ocean-dark border-ocean/20',
  accommodation: 'bg-sunset/10 text-sunset border-sunset/20',
  transport: 'bg-sky/30 text-ocean-dark border-ocean/20',
  food: 'bg-accent/50 text-accent-foreground border-accent/30',
  other: 'bg-muted text-muted-foreground border-border'
};

const ItineraryCard: React.FC<ItineraryCardProps> = ({ item }) => {
  const formatTime = (timeString?: string) => {
    if (!timeString) return null;
    try {
      return format(new Date(timeString), 'h:mm a');
    } catch {
      return timeString;
    }
  };

  const formatDate = (timeString?: string) => {
    if (!timeString) return null;
    try {
      return format(new Date(timeString), 'MMM d, yyyy');
    } catch {
      return null;
    }
  };

  return (
    <Card className="hover:shadow-lg transition-all duration-300 border-l-4 border-l-ocean bg-gradient-to-r from-card to-sky/5 animate-fade-up">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <CardTitle className="text-lg font-semibold text-card-foreground flex items-center gap-2">
            <span className="text-xl">{categoryIcons[item.category] || '📝'}</span>
            {item.title}
          </CardTitle>
          <Badge 
            variant="secondary" 
            className={`${categoryColors[item.category]} font-medium capitalize`}
          >
            {item.category}
          </Badge>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-3">
        {item.description && (
          <p className="text-muted-foreground text-sm leading-relaxed">
            {item.description}
          </p>
        )}
        
        <div className="flex flex-wrap gap-4 text-sm">
          {item.location && (
            <div className="flex items-center gap-1 text-muted-foreground">
              <MapPin className="w-4 h-4 text-ocean" />
              <span>{item.location}</span>
            </div>
          )}
          
          {item.start_time && (
            <div className="flex items-center gap-1 text-muted-foreground">
              <Clock className="w-4 h-4 text-ocean" />
              <span>{formatTime(item.start_time)}</span>
              {item.end_time && formatTime(item.end_time) && (
                <span> - {formatTime(item.end_time)}</span>
              )}
            </div>
          )}
          
          {item.start_time && formatDate(item.start_time) && (
            <div className="flex items-center gap-1 text-muted-foreground">
              <Calendar className="w-4 h-4 text-ocean" />
              <span>{formatDate(item.start_time)}</span>
            </div>
          )}
        </div>
        
        {item.notes && (
          <div className="pt-2 border-t border-border/50">
            <p className="text-xs text-muted-foreground italic">
              {item.notes}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default ItineraryCard;