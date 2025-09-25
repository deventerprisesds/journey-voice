import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Client } from "https://deno.land/x/postgres@v0.17.0/mod.ts";
import "https://deno.land/x/xhr@0.1.0/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ChatMessage {
  id: string;
  content: string;
  role: string;
  timestamp: string;
  metadata?: any;
}

interface EmbeddingMatch {
  content: string;
  similarity: number;
  metadata?: any;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, query, user_input, time_filter, match_threshold = 0.7, match_count = 10 } = await req.json();
    
    const databaseUrl = Deno.env.get('EXTERNAL_DATABASE_URL');
    if (!databaseUrl) {
      throw new Error('EXTERNAL_DATABASE_URL not configured');
    }

    const client = new Client(databaseUrl);
    await client.connect();

    console.log(`External DB Query - Action: ${action}, Query: ${query?.substring(0, 100)}..., Time Filter: ${time_filter}`);

    let result;

    switch (action) {
      case 'search_tasks':
        result = await searchTaskRelatedMessages(client, user_input, time_filter, match_threshold, match_count);
        break;
      
      case 'get_recent_context':
        result = await getRecentChatContext(client, match_count);
        break;
      
      case 'store_conversation':
        const { role, content, metadata } = await req.json();
        result = await storeConversation(client, role, content, metadata);
        break;
      
      default:
        throw new Error(`Unknown action: ${action}`);
    }

    await client.end();

    return new Response(JSON.stringify({ 
      success: true, 
      data: result,
      timestamp: new Date().toISOString()
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('External DB Query Error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function searchTaskRelatedMessages(
  client: Client, 
  userInput: string,
  timeFilter?: string,
  threshold: number = 0.7, 
  limit: number = 10
): Promise<ChatMessage[]> {
  console.log(`Searching for task-related messages: "${userInput}", time filter: "${timeFilter}"`);
  
  // Parse time filter into SQL interval
  let timeInterval = "30 days"; // default
  if (timeFilter) {
    const timeFilterLower = timeFilter.toLowerCase();
    if (timeFilterLower.includes('yesterday')) {
      timeInterval = "2 days";
    } else if (timeFilterLower.includes('today')) {
      timeInterval = "1 day";
    } else if (timeFilterLower.includes('week') || timeFilterLower.includes('7 days')) {
      timeInterval = "7 days";
    } else if (timeFilterLower.includes('month') || timeFilterLower.includes('30 days')) {
      timeInterval = "30 days";
    } else if (timeFilterLower.includes('3 days')) {
      timeInterval = "3 days";
    } else if (timeFilterLower.match(/(\d+)\s*days?/)) {
      const days = timeFilterLower.match(/(\d+)\s*days?/)?.[1];
      timeInterval = `${days} days`;
    }
  }

  // Search for messages containing task-related keywords
  const taskKeywords = [
    'task', 'todo', 'do', 'need to', 'remind', 'schedule', 'deadline',
    'project', 'work', 'meeting', 'appointment', 'call', 'email',
    'buy', 'get', 'pick up', 'finish', 'complete', 'done', 'created',
    'updated', 'status', 'priority', 'urgent', 'important'
  ];

  const keywordPattern = taskKeywords.join('|');
  
  // Query messages with improved time filtering
  const query = `
    SELECT id, content, role, created_at as timestamp, metadata
    FROM chat_messages2 
    WHERE (
      content ILIKE '%' || $1 || '%' 
      OR content ~* $2
      OR (role = 'user' AND content ILIKE '%task%')
      OR (role = 'assistant' AND (content ILIKE '%created%' OR content ILIKE '%updated%'))
    )
    AND created_at >= NOW() - INTERVAL '${timeInterval}'
    ORDER BY created_at DESC
    LIMIT $3
  `;

  const result = await client.queryObject<ChatMessage>(query, [
    userInput.toLowerCase(),
    keywordPattern,
    limit
  ]);

  console.log(`Found ${result.rows.length} task-related messages from ${timeInterval}`);
  return result.rows;
}

async function getRecentChatContext(client: Client, limit: number): Promise<ChatMessage[]> {
  console.log(`Getting recent chat context (${limit} messages)`);
  
  const query = `
    SELECT id, content, role, created_at as timestamp, metadata
    FROM chat_messages2 
    ORDER BY created_at DESC
    LIMIT $1
  `;

  const result = await client.queryObject<ChatMessage>(query, [limit]);
  console.log(`Retrieved ${result.rows.length} recent messages`);
  return result.rows.reverse(); // Return in chronological order
}

async function storeConversation(
  client: Client, 
  role: string, 
  content: string, 
  metadata: any = {}
): Promise<{ id: string }> {
  console.log(`Storing conversation: ${role} - ${content.substring(0, 100)}...`);
  
  const query = `
    INSERT INTO chat_messages2 (role, content, metadata, created_at)
    VALUES ($1, $2, $3, NOW())
    RETURNING id
  `;

  const result = await client.queryObject<{ id: string }>(query, [
    role,
    content,
    JSON.stringify(metadata)
  ]);

  const newId = result.rows[0]?.id;
  console.log(`Stored conversation with ID: ${newId}`);
  return { id: newId };
}