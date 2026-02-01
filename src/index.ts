/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

/// <reference lib="webworker" />

import { prompt } from './prompt';

type Env = {
   ALLOWED_API_KEYS: string;
   OPENROUTER_API_KEY: string;
   OPENROUTER_ENDPOINT?: string;
};

const jsonRegex = /\{(?:[^{}]|{(?:[^{}]|{[^{}]*})*})*\}/g;

export default {
   async fetch(request: Request, env: Env, ctx: unknown): Promise<Response> {
      const corsHeaders = {
         'Access-Control-Allow-Origin': '*',
         'Access-Control-Allow-Methods': 'POST, OPTIONS',
         'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      };

      // Handle CORS preflight
      if (request.method === 'OPTIONS') {
         return new Response(null, {
            status: 204,
            headers: corsHeaders,
         });
      }

      console.log('Received request:');

      if (request.method !== 'POST') {
         return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
      }

      // Get API key from Authorization header
      const authHeader = request.headers.get('Authorization') || '';
      const apiKey = authHeader.replace('Bearer ', '').trim();

      if (!apiKey) {
         return new Response('Missing Authorization header', { status: 401, headers: corsHeaders });
      }

      // Parse multipart form data for image
      const contentType = request.headers.get('content-type') || '';
      if (!contentType.includes('multipart/form-data')) {
         return new Response('Content-Type must be multipart/form-data', { status: 400, headers: corsHeaders });
      }

      const formData = await request.formData();
      const imageFile = formData.get('image') as File | null;

      if (!imageFile) {
         return new Response('Missing image field', { status: 400, headers: corsHeaders });
      }

      const allowedApiKeys = env.ALLOWED_API_KEYS.split(',')
         .map((key) => key.trim())
         .filter(Boolean);
      if (!allowedApiKeys.includes(apiKey)) {
         return new Response('Unauthorized', { status: 401, headers: corsHeaders });
      }

      // Forward image to OpenRouter (meta-llama/llama-4-maverick:free)
      try {
         console.log('Forwarding image to OpenRouter with meta-llama/llama-4-maverick:free');
         // Read image as base64
         const arrayBuffer = await imageFile.arrayBuffer();
         const uint8Array = new Uint8Array(arrayBuffer);
         let binary = '';
         for (let i = 0; i < uint8Array.length; i++) {
            binary += String.fromCharCode(uint8Array[i]);
         }
         const base64String = btoa(binary);

         // Prepare OpenRouter API call
         const openRouterPayload = {
            model: 'meta-llama/llama-4-maverick:free',
            messages: [
               {
                  role: 'user',
                  content: [
                     {
                        type: 'text',
                        text: prompt,
                     },
                     {
                        type: 'image_url',
                        image_url: `data:${imageFile.type};base64,${base64String}`,
                     },
                  ],
               },
            ],
         };

         const openRouterEndpoint = env.OPENROUTER_ENDPOINT || 'https://openrouter.ai/api/v1/chat/completions';
         const openRouterResponse = await fetch(openRouterEndpoint, {
            method: 'POST',
            headers: {
               'Content-Type': 'application/json',
               Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
               // Optionally add Referer and X-Title for OpenRouter ranking:
               // 'HTTP-Referer': '<YOUR_SITE_URL>',
               // 'X-Title': '<YOUR_SITE_NAME>',
            },
            body: JSON.stringify(openRouterPayload),
         });

         if (!openRouterResponse.ok) {
            return new Response('Error from OpenRouter service', { status: 502, headers: corsHeaders });
         }

         const json = await openRouterResponse.json();
         console.log('Received response from OpenRouter:', json);
         // Extract only the message.content from the first choice
         const content = json.choices?.[0]?.message?.content ?? null;
         const jsonMatch = content?.match(jsonRegex);
         const extractedJson = jsonMatch ? JSON.parse(jsonMatch[0]) : null;

         if (extractedJson == null) {
            return new Response('Invalid response from OpenRouter: cannot extract any JSON', { status: 502, headers: corsHeaders });
         }

         console.log('Extracted JSON:', extractedJson);

         return new Response(JSON.stringify(extractedJson), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
         });
      } catch (error) {
         console.error('Error forwarding to OpenRouter:', error);
         return new Response('Error from OpenRouter service', { status: 502, headers: corsHeaders });
      }
   },
};
