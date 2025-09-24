-- Create itineraries table for managing trip plans
CREATE TABLE public.itineraries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  start_date DATE,
  end_date DATE,
  location TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create itinerary_items table for individual activities/events
CREATE TABLE public.itinerary_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  itinerary_id UUID NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  location TEXT,
  start_time TIMESTAMP WITH TIME ZONE,
  end_time TIMESTAMP WITH TIME ZONE,
  category TEXT DEFAULT 'activity', -- activity, accommodation, transport, food, etc.
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  FOREIGN KEY (itinerary_id) REFERENCES public.itineraries(id) ON DELETE CASCADE
);

-- Enable Row Level Security
ALTER TABLE public.itineraries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.itinerary_items ENABLE ROW LEVEL SECURITY;

-- Create policies for itineraries
CREATE POLICY "Users can view their own itineraries" 
ON public.itineraries 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own itineraries" 
ON public.itineraries 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own itineraries" 
ON public.itineraries 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own itineraries" 
ON public.itineraries 
FOR DELETE 
USING (auth.uid() = user_id);

-- Create policies for itinerary items
CREATE POLICY "Users can view their own itinerary items" 
ON public.itinerary_items 
FOR SELECT 
USING (EXISTS (
  SELECT 1 FROM public.itineraries 
  WHERE id = itinerary_items.itinerary_id 
  AND user_id = auth.uid()
));

CREATE POLICY "Users can create itinerary items in their itineraries" 
ON public.itinerary_items 
FOR INSERT 
WITH CHECK (EXISTS (
  SELECT 1 FROM public.itineraries 
  WHERE id = itinerary_items.itinerary_id 
  AND user_id = auth.uid()
));

CREATE POLICY "Users can update their own itinerary items" 
ON public.itinerary_items 
FOR UPDATE 
USING (EXISTS (
  SELECT 1 FROM public.itineraries 
  WHERE id = itinerary_items.itinerary_id 
  AND user_id = auth.uid()
));

CREATE POLICY "Users can delete their own itinerary items" 
ON public.itinerary_items 
FOR DELETE 
USING (EXISTS (
  SELECT 1 FROM public.itineraries 
  WHERE id = itinerary_items.itinerary_id 
  AND user_id = auth.uid()
));

-- Create function to update timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create triggers for automatic timestamp updates
CREATE TRIGGER update_itineraries_updated_at
  BEFORE UPDATE ON public.itineraries
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_itinerary_items_updated_at
  BEFORE UPDATE ON public.itinerary_items
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();