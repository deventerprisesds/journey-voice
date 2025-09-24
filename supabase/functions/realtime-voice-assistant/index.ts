import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, supabaseKey);

// Task management function handlers
async function handleCreateTask(args: any) {
  try {
    console.log('Creating task:', args);
    
    // Get the default board for the user (simplified - in real app would need user auth)
    const { data: board } = await supabase
      .from('boards')
      .select('*')
      .eq('is_default', true)
      .single();
    
    if (!board) {
      return { success: false, message: 'No default board found' };
    }
    
    const taskData = {
      title: args.title,
      description: args.description || null,
      priority: args.priority || 'MEDIUM',
      category: args.category,
      due_date: args.due_date || null,
      estimate_minutes: args.estimate_minutes || null,
      status: 'TODO',
      board_id: board.id,
      user_id: board.user_id,
    };
    
    const { data, error } = await supabase
      .from('tasks')
      .insert(taskData)
      .select()
      .single();
    
    if (error) {
      console.error('Error creating task:', error);
      return { success: false, message: 'Failed to create task' };
    }
    
    return { 
      success: true, 
      message: `Task "${args.title}" created successfully`,
      task: data 
    };
  } catch (error) {
    console.error('Error in handleCreateTask:', error);
    return { success: false, message: 'Failed to create task' };
  }
}

async function handleUpdateTask(args: any) {
  try {
    console.log('Updating task:', args);
    
    const updates: any = {};
    if (args.title) updates.title = args.title;
    if (args.description) updates.description = args.description;
    if (args.priority) updates.priority = args.priority;
    if (args.status) {
      updates.status = args.status;
      if (args.status === 'DONE') {
        updates.completed_at = new Date().toISOString();
      }
    }
    if (args.due_date) updates.due_date = args.due_date;
    if (args.estimate_minutes) updates.estimate_minutes = args.estimate_minutes;
    
    const { data, error } = await supabase
      .from('tasks')
      .update(updates)
      .eq('id', args.task_id)
      .select()
      .single();
    
    if (error) {
      console.error('Error updating task:', error);
      return { success: false, message: 'Failed to update task' };
    }
    
    return { 
      success: true, 
      message: `Task updated successfully`,
      task: data 
    };
  } catch (error) {
    console.error('Error in handleUpdateTask:', error);
    return { success: false, message: 'Failed to update task' };
  }
}

async function handleGetTasks(args: any) {
  try {
    console.log('Getting tasks:', args);
    
    let query = supabase
      .from('tasks')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (args.status_filter) {
      query = query.eq('status', args.status_filter);
    }
    
    const { data, error } = await query.limit(10);
    
    if (error) {
      console.error('Error getting tasks:', error);
      return { success: false, message: 'Failed to get tasks' };
    }
    
    return { 
      success: true, 
      message: `Found ${data.length} tasks`,
      tasks: data 
    };
  } catch (error) {
    console.error('Error in handleGetTasks:', error);
    return { success: false, message: 'Failed to get tasks' };
  }
}

serve(async (req) => {
  const { headers } = req;
  const upgradeHeader = headers.get("upgrade") || "";

  if (upgradeHeader.toLowerCase() !== "websocket") {
    return new Response("Expected WebSocket connection", { status: 400 });
  }

  const { socket, response } = Deno.upgradeWebSocket(req);
  
  let openAISocket: WebSocket | null = null;
  
  socket.onopen = () => {
    console.log("Client WebSocket connected");
    
    // Connect to OpenAI Realtime API
    try {
      const openaiUrl = "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01";
      openAISocket = new WebSocket(openaiUrl, {
        headers: {
          "Authorization": `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
          "OpenAI-Beta": "realtime=v1"
        }
      });

      openAISocket.onopen = () => {
        console.log("Connected to OpenAI Realtime API");
      };

      openAISocket.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log("OpenAI message type:", data.type);
          
          // Handle function calls for task management
          if (data.type === 'response.function_call_arguments.done') {
            console.log("Function call:", data.name, data.arguments);
            
            let functionResult;
            
            try {
              const args = JSON.parse(data.arguments);
              
              switch (data.name) {
                case 'create_task':
                  functionResult = await handleCreateTask(args);
                  break;
                case 'update_task':
                  functionResult = await handleUpdateTask(args);
                  break;
                case 'get_tasks':
                  functionResult = await handleGetTasks(args);
                  break;
                default:
                  functionResult = { success: false, message: `Unknown function: ${data.name}` };
              }
            } catch (error) {
              console.error('Error executing function:', error);
              functionResult = { success: false, message: 'Function execution failed' };
            }
            
            const functionResponse = {
              type: 'conversation.item.create',
              item: {
                type: 'function_call_output',
                call_id: data.call_id,
                output: JSON.stringify(functionResult)
              }
            };
            
            openAISocket?.send(JSON.stringify(functionResponse));
            openAISocket?.send(JSON.stringify({ type: 'response.create' }));
          }
          
          // Forward all messages to client
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(event.data);
          }
        } catch (error) {
          console.error("Error processing OpenAI message:", error);
        }
      };

      openAISocket.onerror = (error) => {
        console.error("OpenAI WebSocket error:", error);
      };

      openAISocket.onclose = (event) => {
        console.log("OpenAI WebSocket closed:", event.code, event.reason);
        if (socket.readyState === WebSocket.OPEN) {
          socket.close();
        }
      };

    } catch (error) {
      console.error("Error connecting to OpenAI:", error);
      socket.close();
    }
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      console.log("Client message type:", data.type);
      
      // Forward client messages to OpenAI
      if (openAISocket && openAISocket.readyState === WebSocket.OPEN) {
        openAISocket.send(event.data);
      }
    } catch (error) {
      console.error("Error processing client message:", error);
    }
  };

  socket.onclose = () => {
    console.log("Client WebSocket disconnected");
    if (openAISocket) {
      openAISocket.close();
    }
  };

  socket.onerror = (error) => {
    console.error("Client WebSocket error:", error);
    if (openAISocket) {
      openAISocket.close();
    }
  };

  return response;
});