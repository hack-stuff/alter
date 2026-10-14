# Build from the repo root so contracts/ is available:
#   docker build -f services/api/Dockerfile -t alter-api .
FROM python:3.12-slim
WORKDIR /srv
COPY contracts/ contracts/
COPY services/api/ services/api/
RUN pip install --no-cache-dir ./services/api
WORKDIR /srv/services/api
ENV PORT=8080
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
