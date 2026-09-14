# Deploy the lesson conductor (AgentCore + live demo)

AgentCore is not required to run locally, but a public URL and AgentCore Runtime
strengthen the Technical Implementation score.

## Local (what the video should show first)

```bash
cd agent
python -m venv .venv
.venv\Scripts\activate          # Windows
pip install -r requirements.txt
python check_bedrock.py         # must print [OK] for the Strands badge
python -m uvicorn server:app --port 8000
```

```bash
cd frontend
npm install
npm run dev                     # http://localhost:5173
```

`GET /health` → `"coach": "bedrock-agent"` means the orchestrator is on Bedrock.
`"memory": "agentcore"` means `AGENTCORE_MEMORY_ID` is set.

Use Claude (`us.anthropic.claude-sonnet-4-20250514-v1:0`) for the recorded demo
so nested specialist agents-as-tools run. Nova Lite is the cheap path: same
tool names, no nested agents.

## Amazon Bedrock AgentCore Runtime

1. Enable Bedrock model access (Claude Sonnet for the demo).
2. Optional — create an AgentCore Memory resource and set `AGENTCORE_MEMORY_ID`.
3. From `agent/`:

```bash
pip install bedrock-agentcore
docker build -t letssingai-coach .
```

4. Push the image to ECR and create an AgentCore Runtime pointing at it.
   `CMD` is `python runtime.py` (`BedrockAgentCoreApp` when the SDK is installed).
5. Point the frontend at the runtime (or an API Gateway in front of FastAPI):

```
VITE_API_BASE=https://<your-runtime-or-api-gateway>
```

Contract: `POST /coach` streams SSE (`focus`, `diagnosis`, `plan`, `verdict`,
`tool`, `token`, `done`). AgentCore `invoke` collects the same events into one JSON
object (`runtime.py`).

## Live frontend demo

```bash
cd frontend
npm run build
```

Upload `frontend/dist/`. Set `VITE_API_BASE` at **build** time to the public coach URL.

CORS on the FastAPI server is `*`.
