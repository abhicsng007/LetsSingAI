# One-URL live demo: React UI + FastAPI coach on the same origin (HTTPS + mic).
# Build from repo root:
#   docker build -t letssingai .
#   docker run --rm -p 8080:8080 --env-file agent/.env letssingai

FROM node:22-alpine AS ui
WORKDIR /ui
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
ENV VITE_API_BASE=
RUN npm run build

FROM python:3.12-slim
WORKDIR /app
COPY agent/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY agent/ .
COPY --from=ui /ui/dist /app/static
ENV FRONTEND_DIST=/app/static
ENV PORT=8080
EXPOSE 8080
CMD ["sh", "-c", "python -m uvicorn server:app --host 0.0.0.0 --port ${PORT:-8080}"]
