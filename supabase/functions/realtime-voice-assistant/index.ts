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
    if (args.category) updates.category = args.category;
    if (args.blocked_by !== undefined) updates.blocked_by = args.blocked_by;
    if (args.status) {
      updates.status = args.status;
      if (args.status === 'DONE') {
        updates.completed_at = new Date().toISOString();
      } else {
        updates.completed_at = null;
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

async function handleScheduleTasks(args: any) {
  try {
    console.log('Scheduling tasks:', args);
    
    const {
      target_date = null,
      working_hours = 7,
      include_weekends = false
    } = args;

    // Get all pending tasks
    const { data: tasks, error: tasksError } = await supabase
      .from('tasks')
      .select('*')
      .neq('status', 'DONE')
      .order('priority', { ascending: false })
      .order('due_date', { ascending: true });

    if (tasksError) {
      console.error('Error fetching tasks:', tasksError);
      return { success: false, message: 'Failed to fetch tasks for scheduling' };
    }

    if (!tasks || tasks.length === 0) {
      return {
        success: true,
        message: "No pending tasks to schedule",
        scheduled_tasks: []
      };
    }

    // Simple scheduling logic - prioritize by urgency and due dates
    const scheduledTasks = [];
    const targetDateObj = target_date ? new Date(target_date) : new Date();
    targetDateObj.setDate(targetDateObj.getDate() + 1); // Default to tomorrow
    const dailyMinutes = working_hours * 60;
    let currentMinutes = 0;

    // Priority mapping for sorting
    const priorityWeights = { 'URGENT': 4, 'HIGH': 3, 'MEDIUM': 2, 'LOW': 1 };
    
    // Sort tasks by priority and due date
    const sortedTasks = tasks.sort((a, b) => {
      const priorityDiff = priorityWeights[b.priority] - priorityWeights[a.priority];
      if (priorityDiff !== 0) return priorityDiff;
      
      if (a.due_date && b.due_date) {
        return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
      }
      if (a.due_date) return -1;
      if (b.due_date) return 1;
      
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });

    for (const task of sortedTasks) {
      const estimateMinutes = task.estimate_minutes || 60; // Default 1 hour
      
      if (currentMinutes + estimateMinutes <= dailyMinutes) {
        const startTime = new Date(targetDateObj);
        startTime.setHours(9); // Start at 9 AM
        startTime.setMinutes(currentMinutes);
        
        const endTime = new Date(startTime);
        endTime.setMinutes(endTime.getMinutes() + estimateMinutes);

        scheduledTasks.push({
          task_id: task.id,
          title: task.title,
          priority: task.priority,
          category: task.category,
          scheduled_start: startTime.toISOString(),
          scheduled_end: endTime.toISOString(),
          estimate_minutes: estimateMinutes
        });

        currentMinutes += estimateMinutes + 15; // 15 min buffer
      }
    }

    console.log('Generated schedule with', scheduledTasks.length, 'tasks');
    
    return {
      success: true,
      message: `Generated schedule for ${scheduledTasks.length} tasks on ${targetDateObj.toDateString()}`,
      scheduled_tasks: scheduledTasks,
      total_time_hours: Math.round(currentMinutes / 60 * 10) / 10,
      date: targetDateObj.toISOString().split('T')[0]
    };

  } catch (error) {
    console.error('Error in handleScheduleTasks:', error);
    return { success: false, message: 'Failed to schedule tasks' };
  }
}

async function handleGetTasks(args: any): Promise<{ success: boolean; message: string; tasks?: any[]; assistant_response?: any; source?: string }> {
  console.log('handleGetTasks called with args:', args);
  
  try {
    // Extract user input for external database search
    const userInput = args.query || args.user_input || 'show me my tasks';
    const userId = args.user_id;

    console.log(`Searching external database for tasks related to: "${userInput}"`);

    // First, try to get task-related information from external database
    const externalDbResponse = await supabase.functions.invoke('external-db-query', {
      body: {
        action: 'search_tasks',
        user_input: userInput,
        time_filter: args.time_filter,
        match_threshold: 0.6,
        match_count: 15
      }
    });

    console.log('External DB response for tasks:', externalDbResponse);

    // Check if we found relevant task information in external database
    if (externalDbResponse.data?.success && externalDbResponse.data?.data?.length > 0) {
      const chatMessages = externalDbResponse.data.data;
      
      // Extract task-like information from chat messages
      const extractedTasks = chatMessages
        .filter((msg: any) => msg.content && msg.content.toLowerCase().includes('task'))
        .map((msg: any, index: number) => ({
          id: `ext_${msg.id || index}`,
          title: extractTaskTitle(msg.content),
          description: msg.content.substring(0, 200) + '...',
          status: 'EXTERNAL',
          priority: 'MEDIUM',
          source: 'chat_history',
          timestamp: msg.timestamp,
          original_message: msg.content
        }));

      console.log(`Extracted ${extractedTasks.length} task references from chat history`);

      // Also check local Supabase tasks
      const { data: localTasks } = await supabase
        .from('tasks')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(10);

      const allTasks = [
        ...(localTasks || []).map(task => ({ ...task, source: 'supabase' })),
        ...extractedTasks
      ];

      return {
        success: true,
        message: `Found ${allTasks.length} tasks (${localTasks?.length || 0} from your boards, ${extractedTasks.length} from chat history)`,
        tasks: allTasks,
        source: 'external_database'
      };
    }

    // Fallback to local Supabase tasks if no external results
    console.log('No external task results, checking local Supabase...');
    const { data: tasks, error } = await supabase
      .from('tasks')
      .select(`
        id,
        title,
        description,
        status,
        priority,
        due_date,
        created_at,
        updated_at,
        board_id,
        boards!inner(name)
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (tasks && tasks.length > 0) {
      return {
        success: true,
        message: `Found ${tasks.length} tasks from your boards`,
        tasks: tasks.map(task => ({ ...task, source: 'supabase' })),
        source: 'supabase'
      };
    }

    // Final fallback to Assistant API if no tasks anywhere
    console.log('No tasks found anywhere, using Assistant API as fallback...');
    
    try {
    const ragResponse = await supabase.functions.invoke('rag-context-retrieval', {
      body: {
        userInput: userInput,
        userId: userId,
        action: 'get_context'
      }
    });

    let assistantResponse = null;
    if (ragResponse.data?.useAssistantAPI) {
      const hybridResponse = await supabase.functions.invoke('hybrid-assistant-api', {
        body: {
          message: userInput,
          instructions: ragResponse.data.contextualInstructions,
          user_id: userId
        }
      });
      assistantResponse = hybridResponse.data;
    }

    return {
      success: true,
      message: 'No specific tasks found, but retrieved relevant context',
      tasks: [],
      assistant_response: assistantResponse,
      source: 'assistant_fallback'
    };

    } catch (assistantError) {
      console.error('Error with assistant fallback:', assistantError);
      return {
        success: false,
        message: `Error retrieving tasks: ${assistantError instanceof Error ? assistantError.message : 'Unknown error'}`,
        source: 'error'
      };
    }

  } catch (error) {
    console.error('Error in handleGetTasks:', error);
    return {
      success: false,
      message: `Error retrieving tasks: ${error instanceof Error ? error.message : 'Unknown error'}`,
      source: 'error'
    };
  }
}

// Helper function to extract task titles from chat messages
function extractTaskTitle(content: string): string {
  // Simple extraction - look for task-like patterns
  const taskPatterns = [
    /(?:task|todo|need to|remind me to|i should)\s*:?\s*([^.!?]+)/i,
    /^([^.!?]{10,60})/i // First sentence if reasonable length
  ];

  for (const pattern of taskPatterns) {
    const match = content.match(pattern);
    if (match && match[1]) {
      return match[1].trim().replace(/^(to\s+)?/i, '');
    }
  }

  // Fallback to first 50 characters
  return content.substring(0, 50).trim() + (content.length > 50 ? '...' : '');
}

serve(async (req) => {
  const { headers } = req;
  const upgradeHeader = headers.get("upgrade") || "";

  if (upgradeHeader.toLowerCase() !== "websocket") {
    return new Response("Expected WebSocket connection", { status: 400 });
  }

  const { socket, response } = Deno.upgradeWebSocket(req);
  
  let openAISocket: WebSocket | null = null;
  let currentThreadId: string | null = null;
  let voiceSessionId = crypto.randomUUID();
  
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
          
          // Create thread ID when session starts
          if (data.type === "session.created") {
            currentThreadId = crypto.randomUUID();
            console.log("Created thread ID for session:", currentThreadId);
            
            // Create thread record in database
            try {
              await supabase.from('ai_threads').insert({
                id: currentThreadId,
                user_id: '00000000-0000-0000-0000-000000000000' // Using anonymous UUID
              });
            } catch (error) {
              console.error("Error creating thread record:", error);
            }
          }
          
          // Handle assistant responses for RAG storage
          if (data.type === "response.audio_transcript.done" && data.transcript && currentThreadId) {
            console.log("Storing assistant response transcript for RAG");
            await fetch('https://wwxgajrtmslzklnyplah.functions.supabase.co/generate-embeddings', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                userId: '00000000-0000-0000-0000-000000000000',
                threadId: currentThreadId,
                content: data.transcript,
                messageType: 'assistant',
                role: 'assistant',
                voiceSessionId: voiceSessionId,
                metadata: { source: 'realtime_api' }
              })
            }).catch(error => console.error("Error storing assistant response:", error));
          }
          
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
                case 'schedule_tasks':
                  functionResult = await handleScheduleTasks(args);
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

  socket.onmessage = async (event) => {
    try {
      const data = JSON.parse(event.data);
      console.log("Client message type:", data.type);
      
      // Handle conversation.item.create to capture user text input for RAG
      if (data.type === 'conversation.item.create' && 
          data.item?.content?.[0]?.type === 'input_text') {
        const userText = data.item.content[0].text;
        console.log("User text input:", userText);
        
        // Check for hybrid routing and get context
        try {
          const contextResponse = await fetch('https://wwxgajrtmslzklnyplah.functions.supabase.co/rag-context-retrieval', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              userInput: userText,
              userId: '00000000-0000-0000-0000-000000000000',
              threadId: currentThreadId,
              action: 'should_use_assistant'
            })
          });
          
          if (contextResponse.ok) {
            const contextData = await contextResponse.json();
            console.log("Routing decision:", contextData);
            
            if (contextData.useAssistantAPI) {
              console.log("Routing to Assistant API for complex query");
              
              // Get full context and enhanced instructions
              const fullContextResponse = await fetch('https://wwxgajrtmslzklnyplah.functions.supabase.co/rag-context-retrieval', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  userInput: userText,
                  userId: '00000000-0000-0000-0000-000000000000',
                  threadId: currentThreadId,
                  action: 'get_context'
                })
              });
              
              if (fullContextResponse.ok) {
                const fullContext = await fullContextResponse.json();
                
                // Make Assistant API call
                const assistantResponse = await fetch('https://wwxgajrtmslzklnyplah.functions.supabase.co/hybrid-assistant-api', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    userInput: userText,
                    userId: '00000000-0000-0000-0000-000000000000',
                    threadId: currentThreadId || (currentThreadId = crypto.randomUUID()),
                    contextualInstructions: fullContext.contextualInstructions
                  })
                });
                
                if (assistantResponse.ok) {
                  const assistantData = await assistantResponse.json();
                  console.log("Assistant API response received");
                  
                  // Store the assistant response for RAG
                  await fetch('https://wwxgajrtmslzklnyplah.functions.supabase.co/generate-embeddings', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                      userId: '00000000-0000-0000-0000-000000000000',
                      threadId: currentThreadId,
                      content: assistantData.response,
                      messageType: 'assistant',
                      role: 'assistant',
                      voiceSessionId: voiceSessionId,
                      metadata: { source: 'assistant_api', routing_reason: contextData.reason }
                    })
                  }).catch(error => console.error("Error storing assistant response:", error));
                  
                  // Send the response back to the client as a text message that will be spoken
                  socket.send(JSON.stringify({
                    type: 'conversation.item.create',
                    item: {
                      type: 'message',
                      role: 'assistant',
                      content: [
                        {
                          type: 'text',
                          text: assistantData.response
                        }
                      ]
                    }
                  }));
                  
                  socket.send(JSON.stringify({ type: 'response.create' }));
                  
                  return; // Don't forward to OpenAI Realtime API
                }
              }
            }
          }
        } catch (error) {
          console.error("Error in hybrid routing:", error);
        }
        
        // Store user input for RAG
        if (currentThreadId) {
          await fetch('https://wwxgajrtmslzklnyplah.functions.supabase.co/generate-embeddings', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              userId: '00000000-0000-0000-0000-000000000000',
              threadId: currentThreadId,
              content: userText,
              messageType: 'user',
              role: 'user',
              voiceSessionId: voiceSessionId,
              metadata: { source: 'realtime_api' }
            })
          }).catch(error => console.error("Error storing user input:", error));
        }
      }
      
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