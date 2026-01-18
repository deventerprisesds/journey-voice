import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const PERPLEXITY_API_KEY = Deno.env.get('PERPLEXITY_API_KEY');
  
  if (!PERPLEXITY_API_KEY) {
    console.error('[WEB-SEARCH] PERPLEXITY_API_KEY not configured');
    return new Response(JSON.stringify({ 
      success: false, 
      error: "Web search not configured. Please connect the Perplexity connector.",
      answer: "I don't have real-time search enabled, but I can help from my general knowledge."
    }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200 // Return 200 so AI can handle gracefully
    });
  }

  try {
    const { query, recencyFilter = 'day' } = await req.json();

    if (!query) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: "Query is required" 
      }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400
      });
    }

    console.log(`[WEB-SEARCH] Searching for: "${query}" with recency: ${recencyFilter}`);

    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [
          { 
            role: 'system', 
            content: 'Provide a concise, factual answer suitable for speaking aloud. Keep it brief - 2-3 sentences max. Focus on the most important facts.' 
          },
          { role: 'user', content: query }
        ],
        search_recency_filter: recencyFilter // 'day', 'week', 'month', 'year'
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[WEB-SEARCH] Perplexity API error: ${response.status}`, errorText);
      
      return new Response(JSON.stringify({
        success: false,
        error: `Search API error: ${response.status}`,
        answer: "I couldn't search for that information right now. Please try again."
      }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 // Return 200 so AI can handle gracefully
      });
    }
    
    const data = await response.json();
    const answer = data.choices?.[0]?.message?.content || "No results found.";
    const citations = data.citations || [];
    
    console.log(`[WEB-SEARCH] Found answer with ${citations.length} sources`);
    
    return new Response(JSON.stringify({
      success: true,
      answer,
      sources: citations,
      query
    }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });

  } catch (error) {
    console.error('[WEB-SEARCH] Error:', error);
    
    return new Response(JSON.stringify({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error',
      answer: "I encountered an error while searching. Let me help with what I know."
    }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200 // Return 200 so AI can handle gracefully
    });
  }
});
