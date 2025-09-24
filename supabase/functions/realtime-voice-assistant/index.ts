import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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

      openAISocket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log("OpenAI message type:", data.type);
          
          // Handle function calls for itinerary management
          if (data.type === 'response.function_call_arguments.done') {
            console.log("Function call:", data.name, data.arguments);
            
            // For now, just acknowledge the function call
            // In a full implementation, this would interact with the database
            const functionResponse = {
              type: 'conversation.item.create',
              item: {
                type: 'function_call_output',
                call_id: data.call_id,
                output: JSON.stringify({ success: true, message: "Function executed successfully" })
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