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
    const { query, recencyFilter } = await req.json();

    if (!query) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: "Query is required" 
      }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400
      });
    }

    // Detect multi-day queries for appropriate recency filter
    let recency: string = recencyFilter || 'day';
    if (!recencyFilter && /weekend|this week|last week|past \d+ days/i.test(query)) {
      recency = 'week';
    }

    // Prefer high-trust domains for sports scores to avoid partial/projection data
    let searchDomainFilter: string[] | undefined;
    if (/(\bnba\b|\bbox score\b|\bscores?\b)/i.test(query)) {
      searchDomainFilter = [
        'nba.com',
        'espn.com',
        'cbssports.com',
        'basketball-reference.com',
      ];
    }

    console.log(`[WEB-SEARCH] Searching for: "${query}" with recency: ${recency}`);
    if (searchDomainFilter?.length) {
      console.log('[WEB-SEARCH] Domain filter set:', JSON.stringify(searchDomainFilter));
    }

    const requestBody: any = {
      model: 'sonar-pro',  // Advanced model for complete results
      temperature: 0.1,
      messages: [
        { 
          role: 'system', 
          content: `You are a factual search assistant.

RESPONSE RULES:
- Provide COMPLETE data - list ALL items found, not partial lists
- For sports scores: ONLY include FINAL scores (no live/projection/partial)
- Prefer official box score pages (NBA.com) or major sports outlets (ESPN/CBS)
- Weekend = Friday, Saturday, Sunday; Week starts Monday
- End with brief source attribution (e.g., "Source: NBA.com")
- If data is incomplete, explicitly state what's missing
- NEVER fabricate information` 
        },
        { role: 'user', content: query }
      ],
      search_recency_filter: recency,
      web_search_options: {
        search_context_size: 'high'
      },
      max_tokens: 1500
    };

    if (searchDomainFilter?.length) {
      requestBody.search_domain_filter = searchDomainFilter;
    }

    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
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
