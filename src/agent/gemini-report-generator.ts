/**
 * Real Gemini Report Generator
 *
 * Uses Google Gen AI SDK with API key for direct Gemini access.
 *
 * Prerequisites:
 *   - GEMINI_API_KEY environment variable set
 *   - Get a key from https://aistudio.google.com/apikey
 */

import { GoogleGenAI } from '@google/genai';
import { GeminiGenerateFn } from './report-generator.js';

/**
 * Configuration for the Gemini client.
 */
export interface GeminiConfig {
  /** Gemini API key (default: from GEMINI_API_KEY env var) */
  apiKey?: string;
  /** Gemini model name (default: gemini-2.0-flash) */
  model?: string;
}

/**
 * Creates a real Gemini generate function using API key auth.
 */
export function createGeminiClient(config: GeminiConfig = {}): GeminiGenerateFn {
  const apiKey = config.apiKey || process.env.GEMINI_API_KEY || '';
  const modelName = config.model || 'models/gemini-2.5-flash';

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not set. Get one from https://aistudio.google.com/apikey');
  }

  const ai = new GoogleGenAI({ apiKey });

  return async (prompt: string): Promise<string> => {
    const systemInstruction = `You are a cybersecurity forensic analyst for eBeeControl, an autonomous deception engine for Kubernetes. 
Your job is to analyze honeytoken access incidents and provide:
1. A clear summary of what happened
2. The likely attacker intent
3. Recommended follow-up actions for the security team

Be concise, technical, and actionable. Focus on the security implications.`;

    const response = await ai.models.generateContent({
      model: modelName,
      contents: `${systemInstruction}\n\n${prompt}`,
    });

    const text = response.text;
    if (!text) {
      throw new Error('Gemini returned empty response');
    }
    return text;
  };
}

/**
 * Creates a fallback generate function that works without Gemini.
 */
export function createFallbackGenerator(): GeminiGenerateFn {
  return async (prompt: string): Promise<string> => {
    return `[Fallback Report - Gemini unavailable]\n\nIncident analysis based on available data:\n${prompt.substring(0, 200)}...\n\nRecommendation: Review incident manually.`;
  };
}

/**
 * Creates a Gemini client with automatic fallback.
 * Tries real Gemini first, falls back to local generation if unavailable.
 */
export function createGeminiClientWithFallback(config: GeminiConfig = {}): GeminiGenerateFn {
  let useRealGemini = true;
  let realClient: GeminiGenerateFn | null = null;
  const fallback = createFallbackGenerator();

  return async (prompt: string): Promise<string> => {
    if (!useRealGemini) {
      return fallback(prompt);
    }

    try {
      if (!realClient) {
        realClient = createGeminiClient(config);
      }
      return await realClient(prompt);
    } catch (error) {
      console.warn('[Gemini] Falling back to local generation:', error instanceof Error ? error.message : error);
      useRealGemini = false;
      return fallback(prompt);
    }
  };
}
