import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { CATEGORY_WINDOW_MAPPING } from '../_shared/call-context-builder.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const openaiApiKey = Deno.env.get('OPENAI_API_KEY')!;

interface ClassificationRequest {
  task_id: string;
  task_title: string;
  task_category: string | null;
  user_id: string;
  operation: 'INSERT' | 'UPDATE';
}

interface Topic {
  id: string;
  topic_name: string;
  topic_summary: string | null;
  window_affinity: string[];
  example_tasks: string[];
  task_count: number;
}

interface ClassificationResult {
  action: 'existing' | 'new';
  topic_name: string;
  topic_summary: string;
}

/**
 * FRAGMENTATION GUARD — normalize a topic name for duplicate detection.
 *
 * Lowercases, strips punctuation, drops filler words that the classifier tacks on inconsistently
 * ("tasks", "management", "projects", ...), and sorts the remaining tokens. So these all collapse
 * to the same key and are recognised as ONE topic instead of forking new rows:
 *   "Career Development" / "Career Development Tasks" / "Development Career"
 *   "Family Grooming Plans" / "Family Grooming Management" / "Family Grooming Tasks"
 * Deliberately conservative: it only collapses names that are the same words plus filler, never
 * merges genuinely different subjects (e.g. "Vehicle Maintenance" vs "Vehicle Rental" stay apart).
 */
const TOPIC_FILLER_WORDS = new Set([
  'task', 'tasks', 'management', 'managing', 'project', 'projects', 'plan', 'plans', 'planning',
  'activities', 'activity', 'general', 'misc', 'miscellaneous', 'related', 'and', 'the', 'of', 'for',
]);
function normalizeTopicName(name: string): string {
  const tokens = (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !TOPIC_FILLER_WORDS.has(w));
  // If filler was ALL there was, fall back to the raw words so we don't collapse to an empty key.
  const base = tokens.length > 0
    ? tokens
    : (name || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  return [...base].sort().join(' ');
}

async function classifyTaskWithAI(
  taskTitle: string,
  taskCategory: string,
  existingTopics: Topic[]
): Promise<ClassificationResult> {
  // (normalizeTopicName is defined at module scope — see the fragmentation guard below.)
  const topicList = existingTopics.length > 0
    ? existingTopics.map(t => `- "${t.topic_name}": ${t.topic_summary || 'No description'}`).join('\n')
    : '(No existing topics)';

  const prompt = `You are a task organization assistant. Classify this task into a semantic topic.

STRONGLY PREFER AN EXISTING TOPIC. Creating a near-duplicate of one that already exists (e.g. a
separate "Career Development Tasks" when "Career Development" exists) fragments the user's board and
is a failure. Only create a new topic when the task genuinely belongs to no listed topic — a broader
existing topic is almost always the right answer. Do not invent a topic for a single task.

EXISTING TOPICS FOR THIS USER:
${topicList}

NEW TASK:
- Title: "${taskTitle}"
- Category: ${taskCategory}

INSTRUCTIONS:
1. If this task fits well into an existing topic, return action "existing" with that topic_name
2. If no existing topic fits, create a new one with action "new"
3. Topics should be broad enough to group multiple related tasks (e.g., "Financial Management", "Health & Fitness", "Career Development")
4. Topic names should be 2-4 words, professional sounding
5. Topic summary should be a brief description (under 15 words)

Respond ONLY with valid JSON in this exact format:
{"action": "existing" | "new", "topic_name": "...", "topic_summary": "..."}`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 150,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[CLASSIFY-TOPIC] OpenAI API error:', errorText);
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim();
    
    if (!content) {
      throw new Error('Empty response from OpenAI');
    }

    // Parse JSON response
    const result = JSON.parse(content) as ClassificationResult;
    
    // Validate result
    if (!result.action || !result.topic_name) {
      throw new Error('Invalid classification result structure');
    }

    return result;
  } catch (error) {
    console.error('[CLASSIFY-TOPIC] AI classification failed:', error);
    
    // Fallback: create a topic based on category
    const fallbackName = taskCategory === 'CAREER' ? 'Career Tasks'
      : taskCategory === 'PROF_EDUCATION' ? 'Education Tasks'
      : taskCategory === 'VENTURES' ? 'Venture Projects'
      : taskCategory === 'LIFE' || taskCategory === 'PERSONAL' ? 'Personal Tasks'
      : 'General Tasks';
    
    return {
      action: 'new',
      topic_name: fallbackName,
      topic_summary: `Tasks related to ${fallbackName.toLowerCase()}`
    };
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const body = await req.json() as ClassificationRequest;
    const { task_id, task_title, task_category, user_id, operation } = body;

    console.log(`[CLASSIFY-TOPIC] Processing ${operation} for task: ${task_title} (${task_id})`);

    if (!task_id || !task_title || !user_id) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Missing required fields' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Skip if task is test or blocked (double-check)
    if (task_title.toLowerCase().includes('test')) {
      console.log('[CLASSIFY-TOPIC] Skipping test task');
      return new Response(JSON.stringify({ 
        success: true, 
        skipped: true,
        reason: 'test_task'
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get existing topics for this user.
    // LIVE ONLY: archived topics (no open tasks) and merged-away duplicates are excluded so they
    // stop attracting new tasks and stop bloating the prompt. Measured 2026-08-25: 119 topics had
    // accumulated for one user — 74 with zero open tasks — and stuffing all of them into every
    // prompt made the model miss real matches, which spawned yet more near-duplicate topics.
    const { data: existingTopics, error: topicsError } = await supabase
      .from('task_topic_index')
      .select('id, topic_name, topic_summary, window_affinity, example_tasks, task_count')
      .eq('user_id', user_id)
      .is('archived_at', null)
      .is('merged_into', null)
      .order('task_count', { ascending: false });

    if (topicsError) {
      console.error('[CLASSIFY-TOPIC] Error fetching topics:', topicsError);
      throw new Error('Failed to fetch existing topics');
    }

    const topics = (existingTopics || []) as Topic[];
    const category = task_category || 'LIFE';

    // Check if task is already mapped (skip only if mapping exists)
    const { data: existingMapping } = await supabase
      .from('task_topic_mappings')
      .select('id, topic_id')
      .eq('task_id', task_id)
      .maybeSingle();

    if (existingMapping) {
      console.log(`[CLASSIFY-TOPIC] Task already mapped (topic_id=${existingMapping.topic_id}), skipping`);
      return new Response(JSON.stringify({ 
        success: true, 
        skipped: true,
        reason: 'already_mapped'
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // If UPDATE but no mapping exists, proceed with classification (retry)
    if (operation === 'UPDATE') {
      console.log('[CLASSIFY-TOPIC] UPDATE with no existing mapping — proceeding with classification');
    }

    // Classify the task
    const classification = await classifyTaskWithAI(task_title, category, topics);
    console.log('[CLASSIFY-TOPIC] Classification result:', classification);

    let topicId: string;

    if (classification.action === 'existing') {
      // Find the matching topic.
      //
      // FRAGMENTATION GUARD (added 2026-08-25): this used to require an EXACT (case-insensitive)
      // name match, and silently fell through to creating a NEW topic when the model answered
      // "existing" with a slightly different string. That single line is the main reason one user
      // accumulated 119 topics with clusters like "Career Development" / "Career Development Tasks" /
      // "Career Coaching" / "Career Review Management" — the model MEANT the existing topic every
      // time; the code just didn't recognise the name it gave back.
      //
      // Now: exact match first, then a normalized match (case/punctuation/stopword-insensitive), so
      // an intended reuse is honoured instead of silently forking a duplicate.
      const matchingTopic = topics.find(t =>
        t.topic_name.toLowerCase() === classification.topic_name.toLowerCase()
      ) ?? topics.find(t =>
        normalizeTopicName(t.topic_name) === normalizeTopicName(classification.topic_name)
      );
      if (matchingTopic && matchingTopic.topic_name.toLowerCase() !== classification.topic_name.toLowerCase()) {
        console.log(`[CLASSIFY-TOPIC] Fuzzy-matched "${classification.topic_name}" → existing "${matchingTopic.topic_name}" (duplicate avoided)`);
      }

      if (matchingTopic) {
        topicId = matchingTopic.id;
        
        // Update topic: increment count and add to example_tasks
        const updatedExamples = [...(matchingTopic.example_tasks || [])];
        if (!updatedExamples.includes(task_title) && updatedExamples.length < 5) {
          updatedExamples.push(task_title);
        }

        await supabase
          .from('task_topic_index')
          .update({
            task_count: matchingTopic.task_count + 1,
            example_tasks: updatedExamples,
            updated_at: new Date().toISOString()
          })
          .eq('id', topicId);

        console.log(`[CLASSIFY-TOPIC] Added to existing topic: ${matchingTopic.topic_name}`);
      } else {
        // Topic name returned doesn't match any existing - create new
        classification.action = 'new';
      }
    }

    if (classification.action === 'new') {
      // REVIVE-BEFORE-CREATE: the live list excludes archived/merged topics, so the model can't see
      // them and may "invent" a topic that already exists in archived form. Creating it again would
      // both hit the (user_id, topic_name) unique constraint and re-fragment the board. Instead,
      // un-archive the existing row (following merged_into to the canonical topic) and reuse it.
      const { data: dormant } = await supabase
        .from('task_topic_index')
        .select('id, topic_name, task_count, example_tasks, merged_into')
        .eq('user_id', user_id)
        .or(`archived_at.not.is.null,merged_into.not.is.null`);

      const dormantMatch = (dormant || []).find((t: any) =>
        t.topic_name.toLowerCase() === classification.topic_name.toLowerCase() ||
        normalizeTopicName(t.topic_name) === normalizeTopicName(classification.topic_name)
      );

      if (dormantMatch) {
        // Follow the merge chain to the canonical topic, if this one was merged away.
        const reviveId = dormantMatch.merged_into || dormantMatch.id;
        await supabase
          .from('task_topic_index')
          .update({ archived_at: null, updated_at: new Date().toISOString() })
          .eq('id', reviveId);

        await supabase.from('task_topic_mappings').insert({ task_id, topic_id: reviveId });
        console.log(`[CLASSIFY-TOPIC] Revived dormant topic "${dormantMatch.topic_name}" instead of creating a duplicate`);

        return new Response(JSON.stringify({
          success: true, topic_id: reviveId, topic_name: dormantMatch.topic_name, action: 'revived',
        }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // Get window affinity from category
      const windowAffinity = CATEGORY_WINDOW_MAPPING[category] || ['flexible'];

      // Create new topic
      const { data: newTopic, error: createError } = await supabase
        .from('task_topic_index')
        .insert({
          user_id,
          topic_name: classification.topic_name,
          topic_summary: classification.topic_summary,
          window_affinity: windowAffinity,
          category_affinity: category,
          example_tasks: [task_title],
          task_count: 1
        })
        .select('id')
        .single();

      if (createError) {
        // Handle unique constraint violation (topic already exists)
        if (createError.code === '23505') {
          const { data: existingTopic } = await supabase
            .from('task_topic_index')
            .select('id, task_count, example_tasks')
            .eq('user_id', user_id)
            .eq('topic_name', classification.topic_name)
            .single();

          if (existingTopic) {
            topicId = existingTopic.id;
            
            const updatedExamples = [...(existingTopic.example_tasks || [])];
            if (!updatedExamples.includes(task_title) && updatedExamples.length < 5) {
              updatedExamples.push(task_title);
            }

            await supabase
              .from('task_topic_index')
              .update({
                task_count: existingTopic.task_count + 1,
                example_tasks: updatedExamples,
                category_affinity: category,
                updated_at: new Date().toISOString()
              })
              .eq('id', topicId);
          } else {
            throw createError;
          }
        } else {
          throw createError;
        }
      } else {
        topicId = newTopic.id;
        console.log(`[CLASSIFY-TOPIC] Created new topic: ${classification.topic_name}`);
      }
    }

    // Create task-topic mapping
    const { error: mappingError } = await supabase
      .from('task_topic_mappings')
      .insert({
        task_id,
        topic_id: topicId!
      });

    if (mappingError && mappingError.code !== '23505') { // Ignore duplicate key
      console.error('[CLASSIFY-TOPIC] Error creating mapping:', mappingError);
    }

    return new Response(JSON.stringify({
      success: true,
      topic_id: topicId!,
      topic_name: classification.topic_name,
      action: classification.action
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[CLASSIFY-TOPIC] Error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
