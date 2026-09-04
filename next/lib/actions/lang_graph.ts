import "dotenv/config";

import { ChatGroq } from "@langchain/groq";
import {
  StateGraph,
  START,
  END,
  MessagesAnnotation,
} from "@langchain/langgraph";
import { MemorySaver } from "@langchain/langgraph";

// 1. Create the LLM
const llm = new ChatGroq({
  model: "openai/gpt-oss-20b",
});

// 2. Define the chatbot node
async function chatBotNode(
  state: typeof MessagesAnnotation.State
) {
  const response = await llm.invoke(state.messages);

  return {
    messages: [response],
  };
}

// 3. Create in-memory checkpointer
const memory = new MemorySaver();

// 4. Build the graph
const graph = new StateGraph(MessagesAnnotation)
  .addNode("chatBot", chatBotNode)
  .addEdge(START, "chatBot")
  .addEdge("chatBot", END)
  .compile({
    checkpointer: memory,
  });

// 5. Thread configuration
const config = {
  configurable: {
    thread_id: "my-bot-1",
  },
};

// 6. Invoke the graph
const res = await graph.invoke(
  {
    messages: [
      {
        role: "user",
        content: "What is my name?",
      },
    ],
  },
  config
);

// 7. Get the final response
console.log(res.messages[res.messages.length - 1].content);