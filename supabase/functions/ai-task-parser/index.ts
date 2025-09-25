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
    
    if (!text) {
      throw new Error('Text input is required');
    }

    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) {
      throw new Error('OpenAI API key not configured');
    }

    console.log('Parsing task input:', text);

    const systemPrompt = `You are an AI task parser that converts natural language into structured task data. 

Parse the user's input and extract task information. Return a JSON object with the following structure:
{
  "tasks": [
    {
      "title": "clear, actionable title",
      "description": "detailed description if available",
      "priority": "LOW" | "MEDIUM" | "HIGH" | "URGENT",
      "category": "LIFE" | "CAREER" | "VENTURES" | "EDUCATION",
      "due_date": "ISO date string or null",
      "estimate_minutes": "number or null",
      "status": "BACKLOG" | "TODO" | "READY" | "UP_NEXT" | "DOING"
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
      const error = await response.json();
      throw new Error(error.error?.message || 'Failed to parse tasks');
    }

    const data = await response.json();
    const content = data.choices[0].message.content;
    
    try {
      const parsed = JSON.parse(content);
      console.log('Successfully parsed tasks:', parsed);
      return new Response(JSON.stringify(parsed), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } catch (parseError) {
      console.error('Error parsing AI response:', content);
      throw new Error('Failed to parse AI response as JSON');
    }

  } catch (error) {
    console.error('Error in ai-task-parser:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});