import { StringOutputParser } from '@langchain/core/output_parsers';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(import.meta.dirname, '../.env') });

const prompt = ChatPromptTemplate.fromMessages([
    ["system","You are a translater, who trnslate to {language}"],
    ["user", "{query}"]
])

const llm = new ChatGoogleGenerativeAI({
    model: "gemini-3.6-flash",
    apiKey: process.env.GOOGLE_API_KEY || ""
});

const pipe = prompt.pipe(llm).pipe(new StringOutputParser)

async function callGemini(){
    const res = await pipe.invoke({
        language: "bengali",
        query: "How are you"
    });
    console.log(res);
}

callGemini();