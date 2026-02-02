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
      const pdfFile = formData.get('pdf') as File | null;
      const prompt = formData.get('prompt') as string | null;
      const model = (formData.get('model') as string) || 'google/gemini-2.0-flash-lite-preview-02-05:free';

      if (!prompt) {
         return new Response('Missing prompt field', { status: 400, headers: corsHeaders });
      }
      // Default to false, unless explicitly set to true
      const expectJsonRaw = formData.get('expectJson');
      const expectJson = expectJsonRaw === 'true';

      const allowedApiKeys = env.ALLOWED_API_KEYS.split(',')
         .map((key) => key.trim())
         .filter(Boolean);
      if (!allowedApiKeys.includes(apiKey)) {
         return new Response('Unauthorized', { status: 401, headers: corsHeaders });
      }

      // Forward image to OpenRouter (meta-llama/llama-4-maverick:free)
      try {
         console.log('Forwarding to OpenRouter with meta-llama/llama-4-maverick:free');
         // Build content array with prompt and files
         const contentArray: Array<{ type: string; text?: string; image_url?: string }> = [
            {
               type: 'text',
               text: prompt,
            },
         ];

         // Add image if provided
         if (imageFile) {
            const imageArrayBuffer = await imageFile.arrayBuffer();
            const imageUint8Array = new Uint8Array(imageArrayBuffer);
            let imageBinary = '';
            for (let i = 0; i < imageUint8Array.length; i++) {
               imageBinary += String.fromCharCode(imageUint8Array[i]);
            }
            const imageBase64String = btoa(imageBinary);
            contentArray.push({
               type: 'image_url',
               image_url: `data:${imageFile.type};base64,${imageBase64String}`,
            });
         }

         // Add pdf if provided
         if (pdfFile) {
            const pdfArrayBuffer = await pdfFile.arrayBuffer();
            const pdfUint8Array = new Uint8Array(pdfArrayBuffer);
            let pdfBinary = '';
            for (let i = 0; i < pdfUint8Array.length; i++) {
               pdfBinary += String.fromCharCode(pdfUint8Array[i]);
            }
            const pdfBase64String = btoa(pdfBinary);
            contentArray.push({
               type: 'image_url',
               image_url: `data:application/pdf;base64,${pdfBase64String}`,
            });
         }

         // Prepare OpenRouter API call
         const openRouterPayload = {
            model: model,
            messages: [
               {
                  role: 'user',
                  content: contentArray,
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
				console.error('OpenRouter response not ok:', await openRouterResponse.text());
            return new Response('Error from OpenRouter service', { status: 502, headers: corsHeaders });
         }

         const json = await openRouterResponse.json();
         console.log('Received response from OpenRouter:', json);
         // Extract only the message.content from the first choice
         const content = json.choices?.[0]?.message?.content ?? null;

         if (expectJson) {
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
         } else {
            return new Response(JSON.stringify({ response: content }), {
               status: 200,
               headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
         }
      } catch (error) {
         console.error('Error forwarding to OpenRouter:', error);
         return new Response('Error from OpenRouter service', { status: 502, headers: corsHeaders });
      }
   },
};
