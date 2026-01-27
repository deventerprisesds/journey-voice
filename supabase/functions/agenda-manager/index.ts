import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface AgendaItem {
  id: string;
  thread_id: string;
  user_id: string;
  item_index: number;
  item_text: string;
  status: 'pending' | 'in_progress' | 'paused' | 'completed';
  started_at: string | null;
  completed_at: string | null;
  paused_for: string | null;
  paused_at: string | null;
  source: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface AgendaStatus {
  items: AgendaItem[];
  completed: number;
  total: number;
  currentItem: AgendaItem | null;
  isPaused: boolean;
}

/**
 * Parse agenda items from context string
 * Supports formats:
 * - Numbered list: "1. Item one\n2. Item two"
 * - Bullet list: "- Item one\n- Item two"
 * - AGENDA: block format from scheduled calls
 */
function parseAgendaFromContext(context: string): string[] {
  if (!context?.trim()) return [];
  
  const items: string[] = [];
  
  // Look for AGENDA: block first (scheduled call format)
  const agendaMatch = context.match(/AGENDA:\s*([\s\S]*?)(?=\n\n|$)/i);
  if (agendaMatch) {
    const agendaBlock = agendaMatch[1];
    // Parse numbered items from agenda block
    const numberedMatches = agendaBlock.matchAll(/^\s*\d+\.\s*(.+)$/gm);
    for (const match of numberedMatches) {
      const text = match[1].trim();
      if (text) items.push(text);
    }
    if (items.length > 0) return items;
  }
  
  // Try numbered list format
  const numberedMatches = context.matchAll(/^\s*\d+\.\s*(.+)$/gm);
  for (const match of numberedMatches) {
    const text = match[1].trim();
    if (text) items.push(text);
  }
  if (items.length > 0) return items;
  
  // Try bullet list format
  const bulletMatches = context.matchAll(/^\s*[-•]\s*(.+)$/gm);
  for (const match of bulletMatches) {
    const text = match[1].trim();
    if (text) items.push(text);
  }
  
  return items;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { operation, threadId, userId, ...params } = await req.json();
    
    console.log(`[AGENDA-MANAGER] Operation: ${operation}, Thread: ${threadId}, User: ${userId}`);
    
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    
    switch (operation) {
      case 'initialize': {
        // Parse agenda from context and insert items
        const items = parseAgendaFromContext(params.context || '');
        
        if (items.length === 0) {
          console.log('[AGENDA-MANAGER] No agenda items found in context');
          return new Response(JSON.stringify({ 
            success: true, 
            itemCount: 0,
            message: 'No agenda items found in context'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }
        
        // Clear existing agenda for this thread (if re-initializing)
        await supabase
          .from('conversation_agenda')
          .delete()
          .eq('thread_id', threadId);
        
        // Insert new agenda items
        const agendaItems = items.map((text, idx) => ({
          thread_id: threadId,
          user_id: userId,
          item_index: idx,
          item_text: text,
          status: 'pending',
          source: params.source || 'scheduled_call',
          metadata: params.metadata || {}
        }));
        
        const { error } = await supabase
          .from('conversation_agenda')
          .insert(agendaItems);
          
        if (error) {
          console.error('[AGENDA-MANAGER] Insert error:', error);
          throw error;
        }
        
        console.log(`[AGENDA-MANAGER] Initialized ${items.length} agenda items`);
        
        return new Response(JSON.stringify({ 
          success: true, 
          itemCount: items.length,
          items: agendaItems.map(i => ({ index: i.item_index, text: i.item_text }))
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      case 'start_item': {
        const { error } = await supabase
          .from('conversation_agenda')
          .update({ 
            status: 'in_progress', 
            started_at: new Date().toISOString() 
          })
          .eq('thread_id', threadId)
          .eq('item_index', params.itemIndex);
          
        if (error) throw error;
        
        console.log(`[AGENDA-MANAGER] Started item ${params.itemIndex}`);
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      case 'complete_item': {
        // Complete current item
        const { error: completeError } = await supabase
          .from('conversation_agenda')
          .update({ 
            status: 'completed', 
            completed_at: new Date().toISOString() 
          })
          .eq('thread_id', threadId)
          .eq('status', 'in_progress');
          
        if (completeError) throw completeError;
        
        // Find and start next pending item if auto-advance is enabled
        if (params.autoAdvance !== false) {
          const { data: nextItem } = await supabase
            .from('conversation_agenda')
            .select('item_index')
            .eq('thread_id', threadId)
            .eq('status', 'pending')
            .order('item_index', { ascending: true })
            .limit(1)
            .maybeSingle();
            
          if (nextItem) {
            await supabase
              .from('conversation_agenda')
              .update({ 
                status: 'in_progress', 
                started_at: new Date().toISOString() 
              })
              .eq('thread_id', threadId)
              .eq('item_index', nextItem.item_index);
              
            console.log(`[AGENDA-MANAGER] Advanced to item ${nextItem.item_index}`);
          }
        }
        
        console.log(`[AGENDA-MANAGER] Completed current item`);
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      case 'pause_for_tangent': {
        const { error } = await supabase
          .from('conversation_agenda')
          .update({ 
            status: 'paused', 
            paused_for: params.userQuery || null,
            paused_at: new Date().toISOString()
          })
          .eq('thread_id', threadId)
          .eq('status', 'in_progress');
          
        if (error) throw error;
        
        console.log(`[AGENDA-MANAGER] Paused for tangent: "${(params.userQuery || '').substring(0, 40)}..."`);
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      case 'resume': {
        const { error } = await supabase
          .from('conversation_agenda')
          .update({ 
            status: 'in_progress', 
            paused_for: null, 
            paused_at: null 
          })
          .eq('thread_id', threadId)
          .eq('status', 'paused');
          
        if (error) throw error;
        
        console.log(`[AGENDA-MANAGER] Resumed from tangent`);
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      case 'get_resume_hint': {
        const { data: paused } = await supabase
          .from('conversation_agenda')
          .select('item_text, paused_for')
          .eq('thread_id', threadId)
          .eq('status', 'paused')
          .maybeSingle();
          
        const hint = paused?.item_text 
          ? `Getting back to: ${paused.item_text}` 
          : null;
          
        console.log(`[AGENDA-MANAGER] Resume hint: ${hint || 'none'}`);
        return new Response(JSON.stringify({ 
          hint,
          pausedFor: paused?.paused_for || null
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      case 'get_status': {
        const { data: items, error } = await supabase
          .from('conversation_agenda')
          .select('*')
          .eq('thread_id', threadId)
          .order('item_index', { ascending: true });
          
        if (error) throw error;
        
        const agendaItems = (items || []) as AgendaItem[];
        const completed = agendaItems.filter(i => i.status === 'completed').length;
        const currentItem = agendaItems.find(i => 
          i.status === 'in_progress' || i.status === 'paused'
        ) || null;
        const isPaused = agendaItems.some(i => i.status === 'paused');
        
        const status: AgendaStatus = {
          items: agendaItems,
          completed,
          total: agendaItems.length,
          currentItem,
          isPaused
        };
        
        console.log(`[AGENDA-MANAGER] Status: ${completed}/${status.total} completed, paused=${isPaused}`);
        return new Response(JSON.stringify(status), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      case 'clear': {
        // Clear all agenda items for a thread
        const { error } = await supabase
          .from('conversation_agenda')
          .delete()
          .eq('thread_id', threadId);
          
        if (error) throw error;
        
        console.log(`[AGENDA-MANAGER] Cleared agenda for thread ${threadId}`);
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      
      default:
        return new Response(JSON.stringify({ 
          error: `Unknown operation: ${operation}` 
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
    
  } catch (error) {
    console.error('[AGENDA-MANAGER] Error:', error);
    return new Response(JSON.stringify({ 
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
