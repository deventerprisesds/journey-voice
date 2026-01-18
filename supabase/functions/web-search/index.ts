import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface WebSearchArgs {
  query: string;
  topic?: "general" | "news" | "finance";
  search_depth?: "basic" | "advanced";
  time_range?: "day" | "week" | "month" | "year";
  start_date?: string;
  end_date?: string;
  include_domains?: string[];
  exclude_domains?: string[];
  max_results?: number;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const TAVILY_API_KEY = Deno.env.get('TAVILY_API_KEY');
  
  if (!TAVILY_API_KEY) {
    console.error('[WEB-SEARCH] TAVILY_API_KEY not configured');
    return new Response(JSON.stringify({ 
      success: false, 
      error: "Web search not configured. Please add the TAVILY_API_KEY secret.",
      answer: "I don't have real-time search enabled, but I can help from my general knowledge."
    }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200 // Return 200 so AI can handle gracefully
    });
  }

  try {
    const args: WebSearchArgs = await req.json();

    if (!args.query) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: "Query is required" 
      }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400
      });
    }

    console.log('[WEB-SEARCH] ==================== START ====================');
    console.log('[WEB-SEARCH] Using TAVILY API');
    console.log('[WEB-SEARCH] Query (verbatim):', args.query);
    console.log('[WEB-SEARCH] AI-provided params:', JSON.stringify(args, null, 2));

    // Build Tavily request from AI-provided parameters
    const requestBody: Record<string, any> = {
      query: args.query, // VERBATIM - exactly as user spoke
      topic: args.topic || 'general',
      search_depth: args.search_depth || 'advanced',
      max_results: args.max_results || 10,
      include_answer: 'advanced',
      include_raw_content: false,
      include_favicon: false
    };
    
    // Add time filters if AI provided them
    if (args.time_range) requestBody.time_range = args.time_range;
    if (args.start_date) requestBody.start_date = args.start_date;
    if (args.end_date) requestBody.end_date = args.end_date;
    
    // Add domain filters if AI provided them
    if (args.include_domains?.length) requestBody.include_domains = args.include_domains;
    if (args.exclude_domains?.length) requestBody.exclude_domains = args.exclude_domains;

    console.log('[WEB-SEARCH] Tavily request:', JSON.stringify(requestBody, null, 2));

    const startTime = Date.now();
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TAVILY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    const duration = Date.now() - startTime;
    console.log(`[WEB-SEARCH] Tavily responded in ${duration}ms with status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[WEB-SEARCH] Tavily API error: ${response.status}`, errorText);
      
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
    const answer = data.answer || "No results found.";
    const sources = data.results?.map((r: any) => r.url) || [];
    
    console.log('[WEB-SEARCH] ✅ Results count:', data.results?.length || 0);
    console.log('[WEB-SEARCH] Answer preview:', answer.substring(0, 200) + '...');
    console.log('[WEB-SEARCH] Sources:', JSON.stringify(sources));
    console.log('[WEB-SEARCH] ==================== END ====================');
    
    return new Response(JSON.stringify({
      success: true,
      answer,
      sources,
      results: data.results?.map((r: any) => ({
        title: r.title,
        url: r.url,
        content: r.content,
        score: r.score,
        published_date: r.published_date
      })),
      query: args.query,
      paramsUsed: {
        topic: requestBody.topic,
        search_depth: requestBody.search_depth,
        time_range: requestBody.time_range,
        start_date: requestBody.start_date,
        end_date: requestBody.end_date
      }
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
