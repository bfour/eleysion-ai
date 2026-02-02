# Cloudflare Worker: Image Proxy API

This worker exposes a POST endpoint that accepts an image and an API key. If the API key is valid, it forwards the image to an openrouter endpoint and returns the response.

## Usage

- Endpoint: `/` (POST)
- Content-Type: `multipart/form-data`
- Authentication: `Authorization: Bearer <api_key>` header

### Request Format

```
POST /
Authorization: Bearer <your-api-key>
Content-Type: multipart/form-data

image: <image-file>
prompt: "Describe this image"
```

or

```
POST /
Authorization: Bearer <your-api-key>
Content-Type: multipart/form-data

pdf: <pdf-file>
prompt: "Summarize this document"
```

### Fields

- `prompt` (required): Custom text prompt for the model
- `model` (optional): OpenRouter model ID to use (default: `google/gemini-2.0-flash-lite-preview-02-05:free`)
- `image` (optional): Image file to analyze
- `pdf` (optional): PDF file to process
- `expectJson` (optional): "true" or "false" (default). If true, enforces JSON extraction from response.

You can provide any combination of files and text.

### Response

- `200`: JSON response from OpenRouter with extracted data
- `401`: Unauthorized (missing or invalid API key)
- `400`: Bad request (wrong content type)
- `405`: Method not allowed
- `502`: Error from OpenRouter service

## Configuration

Set the following environment variables in `wrangler.jsonc`:

```jsonc
"vars": {
  "ALLOWED_API_KEYS": "key1,key2,key3",
  "OPENROUTER_API_KEY": "sk-or-v1-...",
  "OPENROUTER_ENDPOINT": "https://openrouter.ai/api/v1/chat/completions"
}
```

- `ALLOWED_API_KEYS`: Comma-separated list of valid API keys
- `OPENROUTER_API_KEY`: Your OpenRouter API key
- `OPENROUTER_ENDPOINT`: OpenRouter endpoint (optional, defaults to standard endpoint)

## Deploy

Use [Wrangler](https://developers.cloudflare.com/workers/wrangler/):

```bash
npm run deploy
```
