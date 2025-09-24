import React, { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/components/ui/use-toast';
import ItineraryCard from './ItineraryCard';
import { Loader2, Calendar, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

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

interface ItineraryListProps {
  refreshTrigger?: number;
}

const ItineraryList: React.FC<ItineraryListProps> = ({ refreshTrigger }) => {
  const { toast } = useToast();
  const [items, setItems] = useState<ItineraryItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchItineraryItems = async () => {
    try {
      setLoading(true);
      
      // First, try to get the user's current itinerary
      // For demo purposes, we'll fetch all items, but in a real app you'd filter by itinerary_id
      const { data: itemsData, error: itemsError } = await supabase
        .from('itinerary_items')
        .select('*')
        .order('start_time', { ascending: true, nullsFirst: false });

      if (itemsError) {
        console.error('Error fetching itinerary items:', itemsError);
        toast({
          title: "Error",
          description: "Failed to load itinerary items",
          variant: "destructive",
        });
        return;
      }

      setItems(itemsData || []);
    } catch (error) {
      console.error('Error in fetchItineraryItems:', error);
      toast({
        title: "Error",
        description: "An unexpected error occurred",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItineraryItems();
  }, [refreshTrigger]);

  const addSampleItem = async () => {
    try {
      // For demo purposes, add a sample item
      const sampleItem = {
        title: 'Sample Activity',
        description: 'This is a sample itinerary item added for demonstration',
        category: 'activity',
        location: 'Sample Location',
        start_time: new Date().toISOString(),
        itinerary_id: 'demo-itinerary-id',
        user_id: 'demo-user-id'
      };

      const { error } = await supabase
        .from('itinerary_items')
        .insert([sampleItem]);

      if (error) {
        console.error('Error adding sample item:', error);
        toast({
          title: "Error",
          description: "Failed to add sample item. Please ensure you're authenticated.",
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "Sample Added",
        description: "A sample itinerary item has been added",
      });
      
      fetchItineraryItems();
    } catch (error) {
      console.error('Error in addSampleItem:', error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin text-ocean" />
          <span>Loading your itinerary...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-4xl mx-auto p-6">
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Calendar className="w-8 h-8 text-ocean" />
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-ocean to-ocean-dark bg-clip-text text-transparent">
                Your Itinerary
              </h1>
              <p className="text-muted-foreground">
                Manage your travel plans with voice commands
              </p>
            </div>
          </div>
          
          {items.length === 0 && (
            <Button
              onClick={addSampleItem}
              variant="outline"
              size="sm"
              className="border-ocean/20 text-ocean hover:bg-ocean/5"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Sample
            </Button>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="text-center py-16">
          <div className="mb-6">
            <div className="w-24 h-24 mx-auto mb-4 rounded-full bg-gradient-to-br from-ocean/10 to-sky/30 flex items-center justify-center">
              <Calendar className="w-12 h-12 text-ocean" />
            </div>
            <h3 className="text-xl font-semibold text-card-foreground mb-2">
              No itinerary items yet
            </h3>
            <p className="text-muted-foreground max-w-md mx-auto">
              Start using the voice assistant below to add activities, accommodations, 
              and other items to your travel itinerary.
            </p>
          </div>
          
          <div className="bg-sky/10 border border-ocean/20 rounded-lg p-6 max-w-md mx-auto">
            <h4 className="font-medium text-ocean-dark mb-2">Try saying:</h4>
            <div className="space-y-1 text-sm text-muted-foreground">
              <p>"Add dinner at the Italian restaurant at 7 PM"</p>
              <p>"Schedule a museum visit tomorrow at 10 AM"</p>
              <p>"Add a hotel booking for tonight"</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((item) => (
            <ItineraryCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
};

export default ItineraryList;