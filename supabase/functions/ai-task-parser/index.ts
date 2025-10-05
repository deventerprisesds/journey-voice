import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { text, mode = 'single' } = await req.json();
    
    console.log('📥 Received request:', { text: text?.substring(0, 50), mode });
    
    if (!text) {
      console.error('❌ No text input provided');
      throw new Error('Text input is required');
    }

    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) {
      console.error('❌ OpenAI API key not configured');
      throw new Error('OpenAI API key not configured');
    }

    console.log('✅ Starting task parsing...');

// Get current date for context
const now = new Date();
const currentDateString = now.toLocaleDateString('en-US', { 
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric'
});
const currentTimeString = now.toLocaleTimeString('en-US', { 
  hour: '2-digit',
  minute: '2-digit'
});

const systemPrompt = `You are an intelligent task parser that converts natural language into structured task data with smart context awareness.

CURRENT DATE CONTEXT:
- Today is: ${currentDateString}
- Current time: ${currentTimeString}

CRITICAL: Use this current date as your reference for relative dates like "tomorrow", "next Tuesday", "next week", etc.

Parse the user's input into one or more tasks. Each task should have:
- title: Clear, actionable task title
- description: Optional detailed description with context clues for scheduling
- priority: LOW, MEDIUM, HIGH, or URGENT
- category: LIFE, CAREER, VENTURES, or EDUCATION
- due_date: ISO date string if mentioned (e.g., "2024-01-15T00:00:00.000Z")
- start_time: ISO datetime if specific time mentioned
- end_time: ISO datetime if specific time mentioned or can be calculated
- estimate_minutes: Estimated duration in minutes
- status: BACKLOG, TODO, READY, UP_NEXT, DOING
- scheduling_context: Array of context clues for intelligent scheduling

CONTEXT-AWARE PARSING:
- Bank/financial tasks: Include "business_hours" and "weekdays_only" in scheduling_context
- Shopping/errands: Include "flexible_hours" and "prefer_morning_evening" in scheduling_context
- Work commute tasks: Include "commute_time" and "weekdays_only" in scheduling_context
- Reading/learning: Include "quiet_time" and "evening_preferred" in scheduling_context
- Exercise/gym: Include "morning_evening" and "avoid_meals" in scheduling_context
- Appointments: Include "specific_time" and "business_hours" in scheduling_context
- Personal tasks: Include "flexible" and "weekend_ok" in scheduling_context

Return JSON in this exact format:
{
  "tasks": [
    {
      "title": "string",
      "description": "string or null",
      "priority": "LOW|MEDIUM|HIGH|URGENT",
      "category": "LIFE|CAREER|VENTURES|EDUCATION", 
      "due_date": "ISO string or null",
      "start_time": "ISO string or null",
      "end_time": "ISO string or null",
      "estimate_minutes": number or null,
      "status": "BACKLOG|TODO|READY|UP_NEXT|DOING",
      "scheduling_context": ["array of context clues"]
    }
  ]
}

Guidelines:
- Extract multiple tasks if the input contains a list
- Infer priority from urgency indicators (urgent, asap, high priority, etc.)
- Infer category from context (work/job=CAREER, school/course=EDUCATION, business=VENTURES, personal=LIFE)
- Parse relative dates ("tomorrow", "next week", "in 3 days") into ISO dates
- Parse time estimates ("2 hours", "30 minutes", "half day") into minutes
- Default to BACKLOG status unless urgency suggests TODO/READY/UP_NEXT
- Make titles concise but actionable
- Add context to descriptions when helpful

Examples:
- "Schedule dentist appointment for next Tuesday" → title: "Schedule dentist appointment", due_date: next Tuesday's ISO date
- "Urgent: finish project proposal by Friday, should take 3 hours" → priority: "URGENT", estimate_minutes: 180
- "Learn React, Vue, and Angular" → 3 separate tasks with EDUCATION category`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text }
        ],
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ OpenAI API error:', response.status, errorText);
      try {
        const error = JSON.parse(errorText);
        throw new Error(error.error?.message || 'Failed to parse tasks');
      } catch {
        throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
      }
    }

    const data = await response.json();
    console.log('✅ Got OpenAI response');
    
    const content = data.choices[0]?.message?.content;
    if (!content) {
      console.error('❌ No content in OpenAI response:', data);
      throw new Error('No content received from OpenAI');
    }
    
    try {
      const parsed = JSON.parse(content);
      console.log('✅ Successfully parsed tasks:', parsed.tasks?.length || 0, 'tasks');
      return new Response(JSON.stringify(parsed), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } catch (parseError) {
      console.error('❌ Error parsing AI response as JSON:', content.substring(0, 200));
      throw new Error('Failed to parse AI response as JSON');
    }

  } catch (error) {
    console.error('❌ Error in ai-task-parser:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    const errorDetails = error instanceof Error ? error.stack : '';
    console.error('Error details:', errorDetails);
    
    return new Response(
      JSON.stringify({ 
        error: errorMessage,
        details: 'Check edge function logs for more information'
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});