import { GoogleGenAI, Modality, Type } from "@google/genai";
import { SYSTEM_INSTRUCTION } from "../constants";

const getAI = () => {
  if (!process.env.API_KEY) throw new Error("API_KEY not found");
  return new GoogleGenAI({ apiKey: process.env.API_KEY });
};

export interface GenerateResponse {
  text: string;
  json?: any;
  rawText?: string;
}

const extractJSON = (text: string): any => {
  let cleanText = text.trim();
  
  // 1. Remove Markdown Code Blocks if present
  const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/i;
  const match = cleanText.match(codeBlockRegex);
  if (match) {
    cleanText = match[1];
  }

  // 2. Find the outer braces to ignore pre/postamble text
  const firstBrace = cleanText.indexOf('{');
  const lastBrace = cleanText.lastIndexOf('}');
  
  if (firstBrace !== -1 && lastBrace !== -1) {
    cleanText = cleanText.substring(firstBrace, lastBrace + 1);
  }

  // 3. Cleanup Control Characters that break JSON.parse
  // Remove non-printable characters except newlines/tabs
  cleanText = cleanText.replace(/[\x00-\x09\x0B-\x1F\x7F]/g, "");

  try {
    return JSON.parse(cleanText);
  } catch (e) {
    console.error("JSON Parse Error on text segment:", cleanText);
    throw new Error("Invalid JSON format");
  }
};

export const generateGeometryAction = async (
  prompt: string,
  history: any[],
  imageParts: { mimeType: string; data: string }[] = [],
  thoughtSignature?: string | null,
  isRetry = false
): Promise<GenerateResponse> => {
  const ai = getAI();
  // Strictly use Gemini 3.0 Pro for reasoning
  const modelId = "gemini-3-pro-preview";

  const currentContent = {
    role: "user",
    parts: [
      { text: thoughtSignature ? `Previous thought context: ${thoughtSignature}\n\n${prompt}` : prompt },
      ...imageParts.map(img => ({ inlineData: img }))
    ]
  };

  // Filter history to ensure it complies with API expectations (alternating turns)
  // We assume 'history' passed in is already correct ChatMessage format, 
  // but we need to convert to API format.
  const contents = [...history, currentContent];

  if (isRetry) {
    contents.push({
      role: "user",
      parts: [{ text: "The previous response was not valid JSON. Please output ONLY valid JSON this time. No markdown." }]
    });
  }

  try {
    const response = await ai.models.generateContent({
      model: modelId,
      contents: contents as any,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        temperature: 0.2, 
      }
    });

    const text = response.text || "{}";
    
    try {
      const json = extractJSON(text);
      return { text: json.text || "Processed", json, rawText: text };
    } catch (parseError) {
      console.warn("JSON Parse failed, retrying once...", text);
      if (!isRetry) {
        return generateGeometryAction(prompt, history, imageParts, thoughtSignature, true);
      }
      return { 
        text: "Error parsing model response.", 
        json: { 
          messageType: "chat", 
          text: "I generated a response but it was not valid JSON. Please try again or rephrase." 
        },
        rawText: text
      };
    }
  } catch (err: any) {
    console.error("Gemini API Error", err);
    throw new Error(`AI Request Failed: ${err.message || 'Unknown error'}`);
  }
};

export const generateNotebookSketch = async (lineArtBase64: string): Promise<string> => {
  const ai = getAI();
  const base64Data = lineArtBase64.replace(/^data:image\/(png|jpeg);base64,/, "");

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-image",
      contents: {
        parts: [
          {
            text: "Transform this technical line art into a realistic hand-drawn pencil sketch on graph paper. Maintain geometry but make it look organic, like a high school student's notebook. High contrast, clear lines.",
          },
          {
            inlineData: {
              mimeType: "image/png",
              data: base64Data
            }
          }
        ]
      },
      config: {}
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
       if (part.inlineData) {
         return `data:image/png;base64,${part.inlineData.data}`;
       }
    }
    return "";
  } catch (error: any) {
    console.error("Sketch generation failed", error);
    if (error.toString().includes("403") || error.toString().includes("PERMISSION_DENIED")) {
        throw new Error("Access Denied for 'gemini-2.5-flash-image'. Check your API key permissions.");
    }
    throw error;
  }
};

export const narrateText = async (text: string): Promise<Uint8Array | null> => {
  const ai = getAI();
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: {
        parts: [{ text }]
      },
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } }
        }
      }
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (base64Audio) {
      const binaryString = atob(base64Audio);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return bytes;
    }
    return null;
  } catch (e: any) {
    console.error("TTS failed", e);
    return null;
  }
};