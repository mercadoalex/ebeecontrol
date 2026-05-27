/**
 * Real Gemini Report Generator
 *
 * Uses Google Cloud Vertex AI (Gemini) to generate forensic reports
 * from incident data. Replaces the mock report generator with actual
 * AI-powered analysis.
 *
 * Prerequisites:
 *   - GOOGLE_CLOUD_PROJECT environment variable set
 *   - Application Default Credentials configured
 *   - Vertex AI API enabled on the project
 */

import { VertexAI } from '@google-cloud/vertexai';
import { GeminiGenerateFn } from './report-generator.js';

/**
 * Configuration for the Gemini client.
 */
export interface GeminiConfig {
  /** GCP project ID (default: from GOOGLE_CLOUD_PROJECT env var) */
  projectId?: string;
  /** GCP region (default: us-central1) */
  location?: string;
  /** Gemini model name (default: gemini-1.5-flash) */
  model?: string;
}

/**
 * Creates a real Gemini generate function that calls Vertex AI.
 *
 * This function is compatible with the GeminiGenerateFn interface
 * used by createReportGenerator().
 *
 * Usage:
 *   const gemini = createGeminiClient({ projectId: 'ebeecontrol' });
 *   const reportGenerator = createReportGenerator(gemini);
 */
export function createGeminiClient(config: GeminiConfig = {}): GeminiGenerateFn {
  const projectId = config.projectId || process.env.GOOGLE_CLOUD_PROJECT || 'ebeecontrol';
  const location = config.location || 'us-central1';
  const modelName = config.model || 'gemini-1.5-flash';

  const vertexAI = new VertexAI({ project: projectId, location });
  const model = vertexAI.getGenerativeModel({ model: modelName });

  return async (prompt: string): Promise<string> => {
    const systemInstruction = `You are a cybersecurity forensic analyst for eBeeControl, an autonomous deception engine for Kubernetes. 
Your job is to analyze honeytoken access incidents and provide:
1. A clear summary of what happened
2. The likely attacker intent
3. Recommended follow-up actions for the security team

Be concise, technical, and actionable. Focus on the security implications.`;

    const result = await model.generateContent({
      contents: [
        { role: 'user', parts: [{ text: `${systemInstruction}\n\n${prompt}` }] },
      ],
    });

    const response = result.response;
    const text = response.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      throw new Error('Gemini returned empty response');
    }

    return text;
  };
}

/**
 * Creates a fallback generate function that works without Gemini.
 * Used when Vertex AI is not available (local dev, missing credentials).
 */
export function createFallbackGenerator(): GeminiGenerateFn {
  return async (prompt: string): Promise<string> => {
    return `[Fallback Report - Gemini unavailable]\n\nIncident analysis based on available data:\n${prompt.substring(0, 200)}...\n\nRecommendation: Review incident manually.`;
  };
}

/**
 * Creates a Gemini client with automatic fallback.
 * Tries to use real Gemini, falls back to local generation if unavailable.
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
