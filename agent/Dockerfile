# Amazon Bedrock AgentCore Runtime image for the LetsSingAI vocal-coach
# orchestrator (Strands Agents on Bedrock).
#
# Build (from this folder):
#   docker build -t letssingai-coach .
#
# Local run (FastAPI, port 8080):
#   docker run --rm -p 8080:8080 --env-file .env letssingai-coach
#
# AgentCore: use this Dockerfile with `agentcore deploy` / the AgentCore
# Runtime console. CMD runs the AgentCore entrypoint when bedrock-agentcore
# is present; otherwise it falls back to FastAPI.

FROM public.ecr.aws/docker/library/python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV PORT=8080
EXPOSE 8080

# AgentCore Runtime uses runtime.py (BedrockAgentCoreApp).
CMD ["python", "runtime.py"]
